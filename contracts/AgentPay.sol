// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract AgentPay {
    using SafeERC20 for IERC20;

    // ---- Structs ---------------------------------------------------------------

    struct Agent {
        string name;
        string serviceUrl;
        uint256 pricePerCall;
        address owner;
        bool active;
        uint256 totalCallsPaid;
    }

    struct SpendingLimit {
        uint256 perDay;
        uint256 windowStart;
        uint256 spentInWindow;
        bool configured; // explicit: pay() reverts unless the caller has set a limit
    }

    // ---- Storage ---------------------------------------------------------------

    mapping(address => Agent) public agents;
    address[] private agentList;
    mapping(address => bool) private agentRegistered;

    // Deduplication scoped to payer: callIdUsed[payer][callId] — prevents front-running
    mapping(address => mapping(bytes32 => bool)) public callIdUsed;

    mapping(address => SpendingLimit) private limits;

    address public immutable USDC;

    // ---- Events ----------------------------------------------------------------

    event AgentRegistered(address indexed agent, string name, string serviceUrl, uint256 pricePerCall);
    event AgentUpdated(address indexed agent, string name, string serviceUrl, uint256 pricePerCall);
    event AgentActiveChanged(address indexed agent, bool active);
    event PaymentMade(
        address indexed from,
        address indexed to,
        uint256 amount,
        bytes32 indexed callId,
        uint256 timestamp
    );
    event SpendingLimitSet(address indexed caller, uint256 perDay);

    // ---- Constructor -----------------------------------------------------------

    constructor(address usdc_) {
        require(usdc_ != address(0), "USDC: zero address");
        // Verify usdc_ is a contract (has deployed code). USDC is immutable; a bad
        // address makes this deployment permanently unusable.
        require(usdc_.code.length > 0, "USDC: not a contract");
        USDC = usdc_;
    }

    // ---- Agent registration ----------------------------------------------------

    function registerAgent(string calldata name, string calldata serviceUrl, uint256 pricePerCall) external {
        require(!agentRegistered[msg.sender], "Already registered");
        require(bytes(name).length > 0, "Empty name");
        require(pricePerCall > 0, "Price must be positive");

        agents[msg.sender] = Agent(name, serviceUrl, pricePerCall, msg.sender, true, 0);
        agentList.push(msg.sender);
        agentRegistered[msg.sender] = true;

        emit AgentRegistered(msg.sender, name, serviceUrl, pricePerCall);
    }

    function updateAgent(string calldata name, string calldata serviceUrl, uint256 pricePerCall) external {
        require(agents[msg.sender].owner == msg.sender, "Not registered");
        require(bytes(name).length > 0 && pricePerCall > 0, "Invalid agent data");

        Agent storage agent = agents[msg.sender];
        agent.name = name;
        agent.serviceUrl = serviceUrl;
        agent.pricePerCall = pricePerCall;

        emit AgentUpdated(msg.sender, name, serviceUrl, pricePerCall);
    }

    function setActive(bool active_) external {
        require(agents[msg.sender].owner == msg.sender, "Not registered");
        agents[msg.sender].active = active_;
        emit AgentActiveChanged(msg.sender, active_);
    }

    // ---- Payment ---------------------------------------------------------------

    /**
     * @notice Pay an agent for one call.
     * @param to        The registered agent being paid.
     * @param callId    Caller-chosen unique identifier for this call (deduplicated per payer).
     * @param maxAmount Slippage protection: reverts if pricePerCall > maxAmount.
     *                  Pass the price you quoted the user; the call will fail rather
     *                  than drain an unexpectedly large allowance.
     */
    function pay(address to, bytes32 callId, uint256 maxAmount) external {
        require(to != msg.sender, "Cannot pay yourself");
        require(agents[to].active, "Target not active");
        require(!callIdUsed[msg.sender][callId], "callId already used");

        // Spending limit must be explicitly configured — "unlimited" is opt-in, not the default.
        require(limits[msg.sender].configured, "Set a spending limit first");

        // Mark dedup before any external interaction (checks-effects-interactions).
        callIdUsed[msg.sender][callId] = true;

        uint256 amount = agents[to].pricePerCall;
        require(amount <= maxAmount, "Price moved");

        _checkAndUpdateLimit(msg.sender, amount);

        agents[to].totalCallsPaid += 1;

        IERC20(USDC).safeTransferFrom(msg.sender, to, amount);

        emit PaymentMade(msg.sender, to, amount, callId, block.timestamp);
    }

    // ---- Spending limits -------------------------------------------------------

    /**
     * @notice Set a daily USDC spending cap for the caller through this contract.
     * @param perDay  Maximum 6-decimal USDC units spendable in a rolling 24-hour window.
     *                Must be > 0. There is no "unlimited" sentinel; remove the limit
     *                by choosing a very large value if needed.
     */
    function setSpendingLimit(uint256 perDay) external {
        require(perDay > 0, "Limit must be positive");
        SpendingLimit storage lim = limits[msg.sender];
        lim.perDay = perDay;
        lim.configured = true;
        emit SpendingLimitSet(msg.sender, perDay);
    }

    // ---- Views -----------------------------------------------------------------

    function getAgent(address a) external view returns (Agent memory) {
        return agents[a];
    }

    /**
     * @notice Returns one page of active agents plus the total active count.
     * @param offset  Zero-based start index within the active-agent list.
     * @param limit_  Maximum number of agents to return. Clamped to 200.
     */
    function listActiveAgents(uint256 offset, uint256 limit_)
        external
        view
        returns (
            address[] memory pageAddresses,
            Agent[] memory pageAgents,
            uint256 totalActive
        )
    {
        uint256 cap = limit_ > 200 ? 200 : limit_;
        uint256 len = agentList.length;

        // First pass: count active agents to determine totalActive and page boundaries.
        uint256 activeCount;
        for (uint256 i = 0; i < len; i++) {
            if (agents[agentList[i]].active) activeCount++;
        }
        totalActive = activeCount;

        // Second pass: collect the requested page.
        if (offset >= activeCount || cap == 0) {
            return (new address[](0), new Agent[](0), totalActive);
        }

        uint256 pageSize = activeCount - offset < cap ? activeCount - offset : cap;
        pageAddresses = new address[](pageSize);
        pageAgents = new Agent[](pageSize);

        uint256 activeIdx;
        uint256 pageIdx;
        for (uint256 i = 0; i < len && pageIdx < pageSize; i++) {
            address agentAddr = agentList[i];
            if (!agents[agentAddr].active) continue;
            if (activeIdx >= offset) {
                pageAddresses[pageIdx] = agentAddr;
                pageAgents[pageIdx] = agents[agentAddr];
                pageIdx++;
            }
            activeIdx++;
        }
    }

    /**
     * @notice Current spend within the rolling 24h window.
     *         Returns 0 if the window has expired (not if unconfigured).
     */
    function spentToday(address caller) external view returns (uint256) {
        SpendingLimit storage lim = limits[caller];
        if (block.timestamp >= lim.windowStart + 24 hours) {
            return 0;
        }
        return lim.spentInWindow;
    }

    /**
     * @notice Returns true if the caller has explicitly configured a spending limit.
     */
    function isLimitConfigured(address caller) external view returns (bool) {
        return limits[caller].configured;
    }

    // ---- Internal --------------------------------------------------------------

    function _checkAndUpdateLimit(address caller, uint256 amount) internal {
        SpendingLimit storage lim = limits[caller];

        // Rolling 24h: reset when 24h have elapsed since the window opened.
        if (block.timestamp >= lim.windowStart + 24 hours) {
            lim.windowStart = block.timestamp;
            lim.spentInWindow = 0;
        }

        require(lim.spentInWindow + amount <= lim.perDay, "Daily limit exceeded");
        lim.spentInWindow += amount;
    }
}

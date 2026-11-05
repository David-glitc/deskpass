// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice Deskpass: 3,000 passes that each earn an equal share of everything sent to the contract after they were minted.
/// Minting burns BOT (tiered price). Anyone can fund the pot in native BOT (`fund()`, same signature Launchdesk calls) or in
/// any ERC-20 (`fundToken`). Each asset is accounted separately, so a hostile token can only hurt its own balance.
/// There is no owner, no upgrade and no fee. A pass owns its rewards: they travel with the NFT when it is sold.
contract Deskpass is ERC721, ReentrancyGuard {
    using Strings for uint256;
    using SafeERC20 for IERC20;

    uint256 public constant MAX_SUPPLY = 3000;
    uint256 public constant MAX_PER_MINT = 10;
    uint256 public constant TIER1_END = 1000;
    uint256 public constant TIER2_END = 2000;
    uint256 public constant PRICE1 = 1 ether;
    uint256 public constant PRICE2 = 2 ether;
    uint256 public constant PRICE3 = 4 ether;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address public constant NATIVE = address(0);
    uint256 private constant ACC = 1e18;

    uint256 public totalMinted;
    uint256 public totalBurned;

    /// @dev One entry per distinct `minted` value at funding time. `acc` is the cumulative reward per pass after that funding.
    struct Checkpoint { uint32 minted; uint224 acc; }
    mapping(address => Checkpoint[]) private _cps;
    mapping(address => uint256) public accPerPass;   // cumulative reward per pass, scaled by ACC
    mapping(address => uint256) public pending;      // funded before the first pass existed
    mapping(address => uint256) private dust;        // sub-unit remainder of past splits, scaled by ACC
    mapping(address => uint256) public totalFunded;
    mapping(address => uint256) public totalClaimed;
    mapping(address => mapping(uint256 => uint256)) public paid; // asset => id => acc already settled
    address[] private _assets;
    mapping(address => bool) private _seen;

    event PassMinted(address indexed to, uint256 indexed firstId, uint256 count, uint256 burned);
    event Funded(address indexed asset, address indexed from, uint256 amount, uint256 accPerPass);
    event Claimed(address indexed asset, address indexed owner, uint256 indexed id, uint256 amount);

    constructor() ERC721("Deskpass", "DPASS") {}

    // ---------------------------------------------------------------- minting
    /// @notice Total price of the next `count` passes (they may straddle tiers).
    function priceFor(uint256 count) public view returns (uint256 total) {
        for (uint256 i = 1; i <= count; i++) total += priceOf(totalMinted + i);
    }
    function priceOf(uint256 id) public pure returns (uint256) {
        return id <= TIER1_END ? PRICE1 : id <= TIER2_END ? PRICE2 : PRICE3;
    }

    /// @notice Mint `count` passes. The BOT you send is burned. Reverts unless `msg.value` is exact.
    function mint(uint256 count) external payable nonReentrant {
        require(count > 0 && count <= MAX_PER_MINT, "bad count");
        uint256 first = totalMinted + 1;
        require(first + count - 1 <= MAX_SUPPLY, "sold out");
        require(msg.value == priceFor(count), "wrong price");
        totalMinted += count;
        totalBurned += msg.value;
        (bool ok,) = DEAD.call{value: msg.value}("");
        require(ok, "burn failed");
        for (uint256 i; i < count; i++) _mint(msg.sender, first + i);
        emit PassMinted(msg.sender, first, count, msg.value);
    }

    // ---------------------------------------------------------------- funding
    receive() external payable { _fund(NATIVE, msg.value); }
    /// @notice Same selector Launchdesk calls on its `desks` address.
    function fund() external payable { _fund(NATIVE, msg.value); }

    /// @notice Fund the pot with any ERC-20. The amount counted is what actually arrived (fee-on-transfer safe).
    function fundToken(address token, uint256 amount) external nonReentrant {
        require(token != NATIVE && token != address(this), "bad token");
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 got = IERC20(token).balanceOf(address(this)) - before;
        _fund(token, got);
    }

    /// @notice Fold anything funded before the first mint into the pot.
    function poke(address asset) external { _fund(asset, 0); }

    function _fund(address asset, uint256 v) private {
        uint256 amount = v + pending[asset];
        if (amount == 0 && dust[asset] == 0) return;
        if (!_seen[asset]) { _seen[asset] = true; _assets.push(asset); }
        if (v > 0) totalFunded[asset] += v;
        uint256 m = totalMinted;
        if (m == 0) { // nobody to pay yet: hold it until the first pass exists
            pending[asset] = amount;
            if (v > 0) emit Funded(asset, msg.sender, v, accPerPass[asset]);
            return;
        }
        pending[asset] = 0;
        // Exact conservation: the sub-unit remainder of every split is carried in `dust` (scaled by ACC) and reused.
        uint256 scaled = amount * ACC + dust[asset];
        uint256 add = scaled / m;
        dust[asset] = scaled - add * m;
        uint256 acc = accPerPass[asset] + add;
        require(acc <= type(uint224).max, "overflow");
        accPerPass[asset] = acc;
        Checkpoint[] storage c = _cps[asset];
        // forge-lint: disable-next-line(unsafe-typecast)
        if (c.length > 0 && c[c.length - 1].minted == m) c[c.length - 1].acc = uint224(acc);
        // forge-lint: disable-next-line(unsafe-typecast)
        else c.push(Checkpoint(uint32(m), uint224(acc)));
        emit Funded(asset, msg.sender, v, acc);
    }

    // ---------------------------------------------------------------- claiming
    /// @dev Reward per pass already behind pass `id` for `asset`: the accumulator after the last funding made before it existed.
    function _baseline(address asset, uint256 id) private view returns (uint256) {
        Checkpoint[] storage c = _cps[asset];
        uint256 lo = 0; uint256 hi = c.length;
        // first index with minted >= id; the entry just before it is the last funding that pass `id` did not share in
        while (lo < hi) { uint256 mid = (lo + hi) / 2; if (c[mid].minted >= id) hi = mid; else lo = mid + 1; }
        return lo == 0 ? 0 : c[lo - 1].acc;
    }

    function claimable(address asset, uint256 id) public view returns (uint256) {
        if (id == 0 || id > totalMinted) return 0;
        uint256 base = _baseline(asset, id); uint256 p = paid[asset][id];
        if (p > base) base = p;
        return (accPerPass[asset] - base) / ACC;
    }

    /// @notice Claim `asset` for passes you own. Use address(0) for BOT.
    function claim(address asset, uint256[] calldata ids) external nonReentrant returns (uint256 total) {
        for (uint256 i; i < ids.length; i++) total += _settle(asset, ids[i]);
        _pay(asset, total);
    }

    /// @notice Claim several assets for several passes in one transaction.
    function claimAll(address[] calldata assets, uint256[] calldata ids) external nonReentrant {
        for (uint256 a; a < assets.length; a++) {
            uint256 total;
            for (uint256 i; i < ids.length; i++) total += _settle(assets[a], ids[i]);
            _pay(assets[a], total);
        }
    }

    function _settle(address asset, uint256 id) private returns (uint256 amt) {
        require(ownerOf(id) == msg.sender, "not your pass");
        uint256 base = _baseline(asset, id); uint256 p = paid[asset][id];
        if (p > base) base = p;
        uint256 acc = accPerPass[asset];
        // Pay whole units only; keep the sub-unit remainder behind the pass by moving `paid` to the exact consumed point.
        amt = (acc - base) / ACC;
        if (amt == 0) return 0;
        paid[asset][id] = base + amt * ACC;
        emit Claimed(asset, msg.sender, id, amt);
    }

    function _pay(address asset, uint256 total) private {
        if (total == 0) return;
        totalClaimed[asset] += total;
        if (asset == NATIVE) { (bool ok,) = msg.sender.call{value: total}(""); require(ok, "send failed"); }
        else IERC20(asset).safeTransfer(msg.sender, total);
    }

    // ---------------------------------------------------------------- views
    function assets() external view returns (address[] memory) { return _assets; }
    function tierOf(uint256 id) public pure returns (uint256) { return id <= TIER1_END ? 1 : id <= TIER2_END ? 2 : 3; }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        uint256 t = tierOf(id);
        string memory col = t == 1 ? "#d9b64a" : t == 2 ? "#9aa7b4" : "#b8744a";
        string memory name = t == 1 ? "Founder" : t == 2 ? "Floor" : "Standard";
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 560"><rect width="400" height="560" rx="24" fill="#0c1018"/>',
            '<rect x="20" y="20" width="360" height="520" rx="16" fill="none" stroke="', col, '" stroke-width="4"/>',
            '<rect x="70" y="150" width="260" height="40" rx="6" fill="', col, '"/><rect x="100" y="190" width="18" height="110" fill="#e8e3d3"/><rect x="282" y="190" width="18" height="110" fill="#e8e3d3"/>',
            '<text x="200" y="80" text-anchor="middle" font-family="monospace" font-size="26" fill="', col, '">DESKPASS</text>',
            '<text x="200" y="400" text-anchor="middle" font-family="monospace" font-size="22" fill="#e8e3d3">', name, '</text>',
            '<text x="200" y="500" text-anchor="middle" font-family="monospace" font-size="34" fill="#e8e3d3">#', id.toString(), '</text></svg>');
        return string.concat("data:application/json;base64,", Base64.encode(bytes(string.concat(
            '{"name":"Deskpass #', id.toString(), '","description":"Earns an equal share of every BOT or ERC-20 funded into the Deskpass pot after it was minted.",',
            '"attributes":[{"trait_type":"Tier","value":"', name, '"}],"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)), '"}'))));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import {Deskpass} from "../src/Deskpass.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract T is ERC20 {
    constructor() ERC20("T", "T") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
}
/// 10% fee-on-transfer token
contract FeeToken is ERC20 {
    constructor() ERC20("F", "F") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
    function _update(address f, address t, uint256 a) internal override {
        if (f != address(0) && t != address(0)) { uint256 fee = a / 10; super._update(f, address(0), fee); a -= fee; }
        super._update(f, t, a);
    }
}
/// Behaves like Launchdesk: only knows `fund()`.
interface IDesks { function fund() external payable; }

contract DeskpassTest is Test {
    Deskpass d; address a = address(0xA11CE); address b = address(0xB0B); address c = address(0xC0DE);
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    function setUp() public {
        d = new Deskpass();
        vm.deal(a, 1_000_000 ether); vm.deal(b, 1_000_000 ether); vm.deal(c, 1_000_000 ether); vm.deal(address(this), 1_000_000 ether);
    }
    function _mint(address who, uint256 n) internal { uint256 p = d.priceFor(n); vm.prank(who); d.mint{value: p}(n); }

    function test_tierPricing() public {
        assertEq(d.priceFor(1), 1 ether);
        assertEq(d.priceFor(10), 10 ether);
        assertEq(d.priceOf(1000), 1 ether); assertEq(d.priceOf(1001), 2 ether);
        assertEq(d.priceOf(2000), 2 ether); assertEq(d.priceOf(2001), 4 ether);
    }
    function test_mintBurnsAndCounts() public {
        uint256 before = DEAD.balance;
        _mint(a, 3);
        assertEq(DEAD.balance - before, 3 ether); assertEq(d.totalBurned(), 3 ether);
        assertEq(d.balanceOf(a), 3); assertEq(d.ownerOf(3), a); assertEq(address(d).balance, 0);
    }
    function test_mintStraddlesTierAndRejectsWrongPrice() public {
        for (uint256 i; i < 99; i++) _mint(a, 10);   // 990
        _mint(a, 10); // 991..1000 at 1
        assertEq(d.totalMinted(), 1000);
        assertEq(d.priceFor(2), 4 ether);
        vm.prank(b); vm.expectRevert("wrong price"); d.mint{value: 3 ether}(2);
        vm.prank(b); vm.expectRevert("bad count"); d.mint{value: 0}(0);
        vm.prank(b); vm.expectRevert("bad count"); d.mint{value: 11 ether}(11);
    }
    function test_soldOut() public {
        // fill supply cheaply with prank-free loop
        for (uint256 i; i < 300; i++) _mint(a, 10);
        assertEq(d.totalMinted(), 3000);
        uint256 p = d.priceFor(0);
        assertEq(p, 0);
        vm.prank(b); vm.expectRevert("sold out"); d.mint{value: 4 ether}(1);
    }
    function test_equalSplitAmongHolders() public {
        _mint(a, 1); _mint(b, 1);
        d.fund{value: 10 ether}();
        assertEq(d.claimable(address(0), 1), 5 ether); assertEq(d.claimable(address(0), 2), 5 ether);
        uint256[] memory ids = new uint256[](1); ids[0] = 1;
        uint256 bal = a.balance; vm.prank(a); d.claim(address(0), ids);
        assertEq(a.balance - bal, 5 ether); assertEq(d.claimable(address(0), 1), 0);
    }
    function test_latePassGetsNothingFromEarlierFunding() public {
        _mint(a, 1);
        d.fund{value: 6 ether}();
        _mint(b, 1);
        assertEq(d.claimable(address(0), 2), 0);
        assertEq(d.claimable(address(0), 1), 6 ether);
        d.fund{value: 4 ether}();
        assertEq(d.claimable(address(0), 2), 2 ether); assertEq(d.claimable(address(0), 1), 8 ether);
    }
    function test_latePassForNewAssetBaseline() public {
        // asset first funded after pass 1 but before pass 2: pass 2 must not get it
        T t = new T(); t.mint(address(this), 1000e18); t.approve(address(d), type(uint256).max);
        _mint(a, 1);
        d.fundToken(address(t), 100e18);
        _mint(b, 1);
        assertEq(d.claimable(address(t), 2), 0); assertEq(d.claimable(address(t), 1), 100e18);
        d.fundToken(address(t), 100e18);
        assertEq(d.claimable(address(t), 2), 50e18);
        uint256[] memory ids = new uint256[](1); ids[0] = 2; vm.prank(b); d.claim(address(t), ids);
        assertEq(t.balanceOf(b), 50e18);
    }
    function test_fundedBeforeFirstMintWaitsForPoke() public {
        d.fund{value: 3 ether}();
        assertEq(d.pending(address(0)), 3 ether);
        _mint(a, 1);
        assertEq(d.claimable(address(0), 1), 0);
        d.poke(address(0));
        assertEq(d.claimable(address(0), 1), 3 ether);
    }
    function test_receiveWorksAndLaunchdeskStyleCaller() public {
        _mint(a, 2);
        (bool ok,) = address(d).call{value: 2 ether}(""); assertTrue(ok);
        IDesks(address(d)).fund{value: 2 ether}();
        assertEq(d.claimable(address(0), 1) + d.claimable(address(0), 2), 4 ether);
    }
    function test_rewardsTravelWithTheNft() public {
        _mint(a, 1); d.fund{value: 1 ether}();
        vm.prank(a); d.transferFrom(a, b, 1);
        uint256[] memory ids = new uint256[](1); ids[0] = 1;
        vm.prank(a); vm.expectRevert("not your pass"); d.claim(address(0), ids);
        uint256 bal = b.balance; vm.prank(b); d.claim(address(0), ids);
        assertEq(b.balance - bal, 1 ether);
    }
    function test_cannotClaimTwiceOrOthersPass() public {
        _mint(a, 1); d.fund{value: 1 ether}();
        uint256[] memory ids = new uint256[](1); ids[0] = 1;
        vm.prank(a); d.claim(address(0), ids);
        vm.prank(a); assertEq(d.claim(address(0), ids), 0);
        vm.prank(b); vm.expectRevert("not your pass"); d.claim(address(0), ids);
    }
    function test_feeOnTransferFundingCountsWhatArrived() public {
        FeeToken f = new FeeToken(); f.mint(address(this), 100e18); f.approve(address(d), type(uint256).max);
        _mint(a, 1);
        d.fundToken(address(f), 100e18);
        assertEq(d.totalFunded(address(f)), 90e18);
        assertEq(d.claimable(address(f), 1), 90e18);
    }
    function test_claimAllMultiAsset() public {
        T t = new T(); t.mint(address(this), 50e18); t.approve(address(d), type(uint256).max);
        _mint(a, 2); d.fund{value: 4 ether}(); d.fundToken(address(t), 50e18);
        address[] memory assets = new address[](2); assets[0] = address(0); assets[1] = address(t);
        uint256[] memory ids = new uint256[](2); ids[0] = 1; ids[1] = 2;
        uint256 bal = a.balance; vm.prank(a); d.claimAll(assets, ids);
        assertEq(a.balance - bal, 4 ether); assertEq(t.balanceOf(a), 50e18);
        assertEq(d.assets().length, 2);
    }
    function test_tokenUriIsJson() public {
        _mint(a, 1);
        string memory u = d.tokenURI(1);
        assertEq(bytes(u).length > 100, true);
        assertEq(keccak256(bytes(_prefix(u, 29))), keccak256("data:application/json;base64,"));
        vm.expectRevert(); d.tokenURI(99);
    }
    function _prefix(string memory s, uint256 n) internal pure returns (string memory) {
        bytes memory x = bytes(s); bytes memory o = new bytes(n); for (uint256 i; i < n; i++) o[i] = x[i]; return string(o);
    }

    /// Solvency: however funding and minting interleave, total claimable never exceeds what the contract holds.
    function testFuzz_solvent(uint96[6] calldata fund, uint8[6] calldata mints) public {
        uint256 funded;
        for (uint256 i; i < 6; i++) {
            uint256 n = bound(mints[i], 0, 5);
            if (n > 0) _mint(i % 2 == 0 ? a : b, n);
            uint256 f = uint256(fund[i]) % 1000 ether;
            if (f > 0) { d.fund{value: f}(); funded += f; }
        }
        uint256 owed;
        for (uint256 id = 1; id <= d.totalMinted(); id++) owed += d.claimable(address(0), id);
        assertLe(owed, address(d).balance);
        assertLe(owed + 1e6, funded + 1e6);
        // claim everything and make sure no revert / no overpay
        for (uint256 id = 1; id <= d.totalMinted(); id++) {
            uint256[] memory ids = new uint256[](1); ids[0] = id;
            address o = d.ownerOf(id); vm.prank(o); d.claim(address(0), ids);
        }
        assertLe(d.totalClaimed(address(0)), funded);
    }

    // ------------------------------------------------------------ fork (BOT Chain mainnet), run with FOUNDRY_FORK=true
    address constant WBOT = 0xD5452816194a3784dBa983426cCe7c122F4abd30;
    function test_fork_wbotFundingAndRealBurn() public {
        if (!vm.envOr("FOUNDRY_FORK", false)) return;
        vm.createSelectFork("https://rpc.botchain.ai");
        d = new Deskpass();
        vm.deal(a, 100 ether);
        uint256 deadBefore = DEAD.balance;
        vm.prank(a); d.mint{value: 2 ether}(2);
        assertEq(DEAD.balance - deadBefore, 2 ether);
        // WBOT is the ecosystem's main ERC-20: wrap and fund the pot with it
        vm.startPrank(a);
        (bool ok,) = WBOT.call{value: 10 ether}(abi.encodeWithSignature("deposit()")); assertTrue(ok);
        (bool ap,) = WBOT.call(abi.encodeWithSignature("approve(address,uint256)", address(d), type(uint256).max)); assertTrue(ap);
        d.fundToken(WBOT, 10 ether);
        uint256[] memory ids = new uint256[](2); ids[0] = 1; ids[1] = 2;
        d.claim(WBOT, ids);
        vm.stopPrank();
        assertEq(IERC20Like(WBOT).balanceOf(a), 10 ether);
        // native funding the way Launchdesk does it
        vm.deal(address(this), 5 ether);
        IDesks(address(d)).fund{value: 4 ether}();
        assertEq(d.claimable(address(0), 1), 2 ether);
    }
}
interface IERC20Like { function balanceOf(address) external view returns (uint256); }

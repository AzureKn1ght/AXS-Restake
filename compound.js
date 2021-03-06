const { ethers, BigNumber } = require("ethers");
const scheduler = require("node-schedule");
const figlet = require("figlet");
require("dotenv").config();
const fs = require("fs");

// Import environment variables
const RPC_URL = process.env.RONIN_RPC;
const WALLET_ADDRESS = process.env.USER_ADDRESS;
const USER_AGENT = process.env.USER_AGENT;
const PRIV_KEY = process.env.USER_PRIVATE_KEY;

// State storage object for restakes
var restakes = {
  previousRestake: "",
  nextRestake: "",
};

// Initialize ethers components
const provider = new ethers.getDefaultProvider(
  RPC_URL,
  (request_kwargs = {
    headers: { "content-type": "application/json", "user-agent": USER_AGENT },
  })
);

// All relevant addresses needed
const AXS = "0x97a9107c1793bc407d6f527b77e7fff4d812bece";
const SLP = "0xa8754b9fa15fc18bb59458815510e40a12cd2014";
const WETH = "0xc99a6a985ed2cac1ef41640596c5a5f9f4e19ef5";
const LPtoken = "0x306a28279d04a47468ed83d55088d0dcd1369294";
const katanaDEX = "0x7d0556d55ca1a92708681e2e231733ebd922597d";
const axsStaker = "0x05b0bb3c1c320b280501b86706c3551995bc8571";
const slpStaker = "0xd4640c26c1a31cd632d8ae1a96fe5ac135d1eb52";

// Contract ABIs
const slpStakerABI = ["function stake(uint256)"];
const axsStakerABI = ["function claimPendingRewards()"];
const erc20ABI = ["function balanceOf(address) view returns (uint256)"];
const lpABI = [
  "function getReserves() external view returns (uint112, uint112, uint32)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
].concat(erc20ABI);
const katanaDEX_ABI = [
  "function getAmountsOut(uint, address[]) public view returns (uint[])",
  "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
  "function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)",
];

// Setup wallet and contract connections
const wallet = new ethers.Wallet(PRIV_KEY, provider);
const axsContract = new ethers.Contract(AXS, erc20ABI, provider);
const slpContract = new ethers.Contract(SLP, erc20ABI, provider);
const lpContract = new ethers.Contract(LPtoken, lpABI, provider);
const katanaRouter = new ethers.Contract(katanaDEX, katanaDEX_ABI, wallet);
const slpFarmContract = new ethers.Contract(slpStaker, slpStakerABI, wallet);
const axsRewardsContract = new ethers.Contract(axsStaker, axsStakerABI, wallet);

// Main Function
const main = async () => {
  try {
    // hello world
    console.log(
      figlet.textSync("AXSCompound", {
        font: "Standard",
        horizontalLayout: "default",
        verticalLayout: "default",
        width: 80,
        whitespaceBreak: true,
      })
    );
    // current ronin balance
    const balance = await provider.getBalance(WALLET_ADDRESS);
    console.log("RON Balance: " + ethers.utils.formatEther(balance));
    let claimsExists = false;
    try {
      // get stored values from file
      const storedData = JSON.parse(fs.readFileSync("./restakes.json"));
      // not first launch, check data
      if ("nextRestake" in storedData) {
        const nextRestake = new Date(storedData.nextRestake);
        const currentDate = new Date();
        // restore claims schedule
        if (nextRestake > currentDate) {
          console.log("Restored Claim: " + nextRestake);
          scheduler.scheduleJob(nextRestake, AXSCompound);
          claimsExists = true;
        }
      }
    } catch (error) {
      console.error(error);
    }
    //no previous launch
    if (!claimsExists) {
      AXSCompound();
    }
  } catch (error) {
    console.error(error);
  }
};

// AXS Compound Function
const AXSCompound = async () => {
  try {
    // claim AXS rewards and swap to create LP
    const axsBalance = await claimAXSrewards();
    const LPtokenBal = await addRewardstoLP(axsBalance);

    // stake created LP tokens to farm
    return stakeLPintoFarm(LPtokenBal);
  } catch (error) {
    console.error(error);
  }
  return false;
};

// Create LP Function
const addRewardstoLP = async (axsBalance) => {
  try {
    // calculate amount to swap for SLP
    axsBalance = BigNumber.from(axsBalance);
    const formattedBal = Number(ethers.utils.formatEther(axsBalance));
    let amountForSLP = Math.floor((formattedBal / 2) * 1000) / 1000;
    console.log(`Amount for SLP: ${amountForSLP} AXS`);

    // calculate amount to swap for WETH
    amountForSLP = ethers.utils.parseEther(amountForSLP.toString());
    const amountForWETH = axsBalance.sub(amountForSLP);
    const formattedAmt = ethers.utils.formatEther(amountForWETH);
    console.log(`Amount for WETH: ${formattedAmt} AXS`);

    // swap half to WETH first
    const WETHpath = [AXS, WETH];
    const swapWETH = await swapExactTokensForTokens(amountForWETH, WETHpath);
    let swapSLP = false;

    // swap other half for SLP
    if (swapWETH) {
      const SLPpath = [AXS, WETH, SLP];
      swapSLP = await swapExactTokensForTokens(amountForSLP, SLPpath, "SLP");
    }

    // swaps are both done
    if (swapWETH && swapSLP) {
      console.log("Both Swaps Successful");

      // amount of SLP to add to pool
      const slpAmt = await slpContract.balanceOf(WALLET_ADDRESS);
      const slpAmtMin = BigNumber.from(Math.floor(Number(slpAmt) * 0.99));
      console.log("SLP Amount: " + slpAmtMin);

      // amonut of WETH to add to pool
      const LPreserves = await getReserves();
      const wethAmt = quoteAmount(slpAmt, LPreserves);
      const wethAmtMin = wethAmt.sub(wethAmt.div(100));
      console.log("WETH Amount: " + ethers.utils.formatEther(wethAmtMin));

      // set gasLimit
      const overrideOptions = {
        gasLimit: getRandomGas(400000, 500000),
      };

      // add amounts into liquidity pool
      const deadline = Date.now() + 1000 * 60 * 8;
      const addLiquidity = await katanaRouter.addLiquidity(
        SLP,
        WETH,
        slpAmt,
        wethAmt,
        slpAmtMin,
        wethAmtMin,
        WALLET_ADDRESS,
        deadline,
        overrideOptions
      );

      // wait for the transaction to complete
      const receipt = await addLiquidity.wait();
      if (receipt) {
        console.log("ADD LIQUIDITY SUCCESSFUL");

        // get current LP token balance of wallet
        const lpBal = await lpContract.balanceOf(WALLET_ADDRESS);
        console.log("LP Tokens: " + ethers.utils.formatEther(lpBal));

        return lpBal;
      }
    } else {
      throw "Swap process failed";
    }
  } catch (error) {
    console.error(error);
  }
  return false;
};

// Quote Function
const quoteAmount = (slpAmt, LPreserves) => {
  try {
    // Calculate the quote
    slpAmt = BigInt(slpAmt);
    const slpReserves = BigInt(LPreserves.slpBalance);
    const wethReserves = BigInt(LPreserves.wethBalance);
    const wethAmt = (slpAmt * wethReserves) / slpReserves;

    return BigNumber.from(wethAmt);
  } catch (error) {
    console.error(error);
    console.log("Failed to get quotes.");
  }
  return false;
};

// Get Reserves Function
const getReserves = async () => {
  try {
    // get the LP reserves values
    const LPreserves = await lpContract.getReserves();
    const token0 = await lpContract.token0();

    // assign values based on address
    let balances = { slpBalance: 0, wethBalance: 0 };
    if (SLP.toLowerCase() === token0.toLowerCase()) {
      balances.slpBalance = LPreserves[0];
      balances.wethBalance = LPreserves[1];
    } else {
      balances.slpBalance = LPreserves[1];
      balances.wethBalance = LPreserves[0];
    }

    return balances;
  } catch (error) {
    console.error(error);
  }
  return false;
};

// Swaps Function
const swapExactTokensForTokens = async (amountIn, path, mode) => {
  try {
    // get amount out from katana router
    const amtInFormatted = ethers.utils.formatEther(amountIn);
    const result = await katanaRouter.getAmountsOut(amountIn, path);
    const expectedAmt = result[result.length - 1];
    const deadline = Date.now() + 1000 * 60 * 8;
    let amountOutMin, amountOut;

    // calculate input variables
    if (mode === "SLP") {
      // calculate 1% slippage amount for SLP
      amountOut = Math.floor(Number(expectedAmt) * 0.99);
      amountOutMin = BigNumber.from(amountOut);
    } else {
      // calculate 1% slippage for other ERC20
      amountOutMin = expectedAmt.sub(expectedAmt.div(100));
      amountOut = ethers.utils.formatEther(amountOutMin);
    }

    // console log the details
    console.log("Swapping Tokens...");
    console.log("Path: " + path);
    console.log("Amount In: " + amtInFormatted);
    console.log("Amount Out: " + amountOut);

    // set random gasLimit
    const overrideOptions = {
      gasLimit: getRandomGas(400000, 500000),
    };

    // execute the swapping transaction
    const swap = await katanaRouter.swapExactTokensForTokens(
      amountIn,
      amountOutMin,
      path,
      WALLET_ADDRESS,
      deadline,
      overrideOptions
    );

    // wait for transaction to complete
    const receipt = await swap.wait();
    if (receipt) {
      console.log("TOKEN SWAP SUCCESSFUL");
      return true;
    }
  } catch (error) {
    console.error(error);
  }
  return false;
};

// Stake Function
const stakeLPintoFarm = async (LPtokenBal) => {
  try {
    // set random gasLimit
    const overrideOptions = {
      gasLimit: getRandomGas(400000, 500000),
    };

    // execute AXS staking transaction
    console.log("Staking LP Tokens...");
    const stake = await slpFarmContract.stake(LPtokenBal, overrideOptions);
    const receipt = await stake.wait();

    // wait for transaction to complete
    if (receipt) {
      console.log("LP STAKE SUCCESSFUL");
      return true;
    }
  } catch (error) {
    console.error(error);
  }
  return false;
};

// Claims Function
const claimAXSrewards = async () => {
  try {
    // set random gasLimit
    const overrideOptions = {
      gasLimit: getRandomGas(400000, 500000),
    };

    // execute the AXS claiming transaction
    const claim = await axsRewardsContract.claimPendingRewards(overrideOptions);
    const receipt = await claim.wait();

    // wait for the transaction to complete
    if (receipt) {
      restakes.previousRestake = new Date().toString();
      console.log("AXS CLAIM SUCCESSFUL");
      const axsBal = await axsContract.balanceOf(WALLET_ADDRESS);
      console.log("AXS Balance: " + ethers.utils.formatEther(axsBal));

      // schedule next claim
      scheduleNext(new Date());
      return axsBal;
    }
  } catch (error) {
    console.error(error);
    console.log("Claims Attempt Failed!");
    console.log("Trying again tomorrow.");

    // claims failed try again tomorrow
    scheduleNext(new Date());
  }
  return false;
};

// Job Scheduler Function
const scheduleNext = async (nextDate) => {
  // set next (24hrs, 1min, 30sec from now)
  nextDate.setHours(nextDate.getHours() + 24);
  nextDate.setMinutes(nextDate.getMinutes() + 1);
  nextDate.setSeconds(nextDate.getSeconds() + 30);
  restakes.nextRestake = nextDate.toString();
  console.log("Next Restake: " + nextDate);

  // schedule next restake
  scheduler.scheduleJob(nextDate, AXSCompound);
  storeData();
  return;
};

// Data Storage Function
const storeData = async () => {
  const data = JSON.stringify(restakes);
  fs.writeFile("./restakes.json", data, (err) => {
    if (err) {
      console.error(err);
    } else {
      console.log("Data stored: \n" + data);
    }
  });
};

// Generate random GAS Function
const getRandomGas = (min, max) => {
  try {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  } catch (error) {
    console.error(error);
  }
  return max;
};

main();

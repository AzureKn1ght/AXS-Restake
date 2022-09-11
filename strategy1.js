/*
- Strategy 1 - 
This strategy involves claiming the rewards (AXS tokens) and swapping the AXS tokens to RON and WETH to create LP tokens and deposit the LP tokens into the farm on the Katana DEX for RON rewards, thereby compounding the daily RON yields. 

From: https://stake.axieinfinity.com/ 
To: https://katana.roninchain.com/#/farm
*/

// Import required node modules
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

// All relevant addresses needed
const AXS = "0x97a9107c1793bc407d6f527b77e7fff4d812bece";
const WETH = "0xc99a6a985ed2cac1ef41640596c5a5f9f4e19ef5";
const WRON = "0xe514d9deb7966c8be0ca922de8a064264ea6bcd4";
const LPtoken = "0x2ecb08f87f075b5769fe543d0e52e40140575ea7";
const katanaDEX = "0x7d0556d55ca1a92708681e2e231733ebd922597d";
const axsStaker = "0x05b0bb3c1c320b280501b86706c3551995bc8571";
const ronStaker = "0xb9072cec557528f81dd25dc474d4d69564956e1e";

// Contract ABIs
const ronStakerABI = ["function stake(uint256)"];
const axsStakerABI = ["function claimPendingRewards()"];
const erc20ABI = ["function balanceOf(address) view returns (uint256)"];
const katanaDEX_ABI = [
  "function getAmountsOut(uint, address[]) public view returns (uint[])",
  "function swapExactTokensForRON(uint256,uint256,address[],address,uint256)",
  "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
  "function addLiquidityRON(address,uint,uint,uint,address,uint) payable returns (uint amountToken, uint amountRON, uint liquidity)",
];
const lpABI = [
  "function getReserves() external view returns (uint112, uint112, uint32)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
].concat(erc20ABI);

// Ethers vars
var wallet,
  provider,
  axsContract,
  lpContract,
  katanaRouter,
  ronFarmContract,
  axsRewardsContract;

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
    let claimsExists = false;

    // get stored values from file
    const storedData = JSON.parse(fs.readFileSync("./restakes.json"));

    // not first launch, check data
    if ("nextRestake" in storedData) {
      const nextRestake = new Date(storedData.nextRestake);

      // restore claims schedule
      if (nextRestake > new Date()) {
        console.log("Restored Claim: " + nextRestake);
        scheduler.scheduleJob(nextRestake, AXSCompound);
        claimsExists = true;
      }
    }

    //no previous launch
    if (!claimsExists) {
      AXSCompound();
    }
  } catch (error) {
    console.error(error);
  }
};

// Ethers vars connect
const connect = () => {
  const connection = {
    url: RPC_URL,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "X-Forwarded-For": randomIP(),
    },
  };

  console.log(connection);
  provider = new ethers.providers.JsonRpcProvider(connection);

  wallet = new ethers.Wallet(PRIV_KEY, provider);
  axsContract = new ethers.Contract(AXS, erc20ABI, wallet);
  lpContract = new ethers.Contract(LPtoken, lpABI, wallet);
  katanaRouter = new ethers.Contract(katanaDEX, katanaDEX_ABI, wallet);
  ronFarmContract = new ethers.Contract(ronStaker, ronStakerABI, wallet);
  axsRewardsContract = new ethers.Contract(axsStaker, axsStakerABI, wallet);
  console.log("--> connected\n");
};

// Ethers vars disconnect
const disconnect = () => {
  provider = null;
  wallet = null;
  axsContract = null;
  lpContract = null;
  katanaRouter = null;
  ronFarmContract = null;
  axsRewardsContract = null;
  console.log("-disconnected-\n");
};

// AXS Compound Function
const AXSCompound = async () => {
  console.log("--- AXSCompound Start ---");
  try {
    // start
    connect();
    const balance = await provider.getBalance(WALLET_ADDRESS);
    console.log("RON Balance: " + ethers.utils.formatEther(balance));

    // claim AXS rewards, retries 3 times
    const axsBalance = await claimAXSrewards(1);

    // claims failed throw an exception
    if (!axsBalance) throw "AXS claims failed";

    // swap the AXS tokens and create LP
    const LPtokenBal = await addRewardstoLP(axsBalance);

    // stake created LP tokens to farm
    await stakeLPintoFarm(LPtokenBal);

    return disconnect();
  } catch (error) {
    // try again tomorrow
    console.error(error);
    scheduleNext(new Date());
  }

  return disconnect();
};

// Create LP Function
const addRewardstoLP = async (axsBalance) => {
  try {
    // calculate amount to swap for RON
    axsBalance = BigNumber.from(axsBalance);
    const formattedBal = Number(ethers.utils.formatEther(axsBalance));
    let amountForRON = Math.floor((formattedBal / 2) * 1000) / 1000;
    console.log(`Amount for RON: ${amountForRON} AXS`);

    // calculate amount to swap for WETH
    amountForRON = ethers.utils.parseEther(amountForRON.toString());
    const amountForWETH = axsBalance.sub(amountForRON);
    const formattedAmt = ethers.utils.formatEther(amountForWETH);
    console.log(`Amount for WETH: ${formattedAmt} AXS`);

    // swap half to WETH first
    const WETHpath = [AXS, WETH];
    const swapWETH = await swapExactTokensForTokens(amountForWETH, WETHpath);
    let swapRON = false;

    // swap other half for RON
    if (swapWETH) {
      const RONpath = [AXS, WETH, WRON];
      swapRON = await swapExactTokensForTokens(amountForRON, RONpath, "RON");
    }

    // swaps are both done
    if (swapWETH && swapRON) {
      console.log("-Both Swaps Successful-");
      const randomGas = getRandomNum(400000, 500000);
      const keepRON = ethers.utils.parseEther("0.025");

      // amount of RON to add to pool
      let ronAmt = await provider.getBalance(WALLET_ADDRESS);
      ronAmt = ronAmt.sub(keepRON).sub(randomGas);
      const ronAmtMin = ronAmt.sub(ronAmt.div(100));
      console.log("RON Amount: " + ethers.utils.formatEther(ronAmt));

      // msg.value is treated as a amountRONDesired.
      const overrideOptions = {
        gasLimit: randomGas,
        value: ronAmt,
      };

      // amount of WETH to add to pool
      const LPreserves = await getReserves();
      const wethAmt = quoteAmount(ronAmt, LPreserves);
      const wethAmtMin = wethAmt.sub(wethAmt.div(100));
      console.log("WETH Amount: " + ethers.utils.formatEther(wethAmt));

      // add amounts into liquidity pool
      const deadline = Date.now() + 1000 * 60 * 8;
      const addLiquidity = await katanaRouter.addLiquidityRON(
        WETH,
        wethAmt,
        wethAmtMin,
        ronAmtMin,
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
const quoteAmount = (ronAmt, LPreserves) => {
  try {
    // Calculate the quote
    ronAmt = BigInt(ronAmt);
    const ronReserves = BigInt(LPreserves.ronBalance);
    const wethReserves = BigInt(LPreserves.wethBalance);
    const wethAmt = (ronAmt * wethReserves) / ronReserves;

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
    let balances = { ronBalance: 0, wethBalance: 0 };
    if (WRON.toLowerCase() === token0.toLowerCase()) {
      balances.ronBalance = LPreserves[0];
      balances.wethBalance = LPreserves[1];
    } else {
      balances.ronBalance = LPreserves[1];
      balances.wethBalance = LPreserves[0];
    }

    return balances;
  } catch (error) {
    console.error(error);
    console.log("Failed to get reserves.");
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

    // calculate 1% slippage for ERC20 tokens
    const amountOutMin = expectedAmt.sub(expectedAmt.div(100));
    const amountOut = ethers.utils.formatEther(amountOutMin);

    // console log the details
    console.log("Swapping Tokens...");
    console.log("Path: " + path);
    console.log("Amount In: " + amtInFormatted);
    console.log("Amount Out: " + amountOut);
    let swap;

    // set random gasLimit
    const overrideOptions = {
      gasLimit: getRandomNum(400000, 500000),
    };

    // execute the swap using the appropriate function
    if (mode === "RON") {
      // use the swapExactTokensForRON function
      swap = await katanaRouter.swapExactTokensForRON(
        amountIn,
        amountOutMin,
        path,
        WALLET_ADDRESS,
        deadline,
        overrideOptions
      );
    } else {
      // use the swapExactTokensForTokens function
      swap = await katanaRouter.swapExactTokensForTokens(
        amountIn,
        amountOutMin,
        path,
        WALLET_ADDRESS,
        deadline,
        overrideOptions
      );
    }

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
      gasLimit: getRandomNum(400000, 500000),
    };

    // execute AXS staking transaction
    console.log("Staking LP Tokens...");
    const stake = await ronFarmContract.stake(LPtokenBal, overrideOptions);
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
const claimAXSrewards = async (tries) => {
  try {
    // limit to maximum 3 tries
    if (tries > 3) return false;
    console.log(`Try #${tries}...`);
    console.log("Claiming AXS Rewards...");

    // set random gasLimit
    const overrideOptions = {
      gasLimit: getRandomNum(400000, 500000),
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
    // failed try again
    console.error(error);
    console.log("Claim Attempt Failed!");

    // refresh the connection
    console.log("reconnecting...");
    disconnect();
    connect(); 
    
    return await claimAXSrewards(++tries);
  }
  return false;
};

// Job Scheduler Function
const scheduleNext = async (nextDate) => {
  // set next job to be 24hrs from now
  nextDate.setHours(nextDate.getHours() + 24);

  // add randomized buffer delay 
  const d = getRandomNum(144, 233);
  nextDate.setSeconds(nextDate.getSeconds() + d);
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

// Random IP Function
const randomIP = () => {
  const A = getRandomNum(100, 255);
  const B = getRandomNum(0, 255);
  const C = getRandomNum(0, 255);
  const D = getRandomNum(0, 255);
  return `${A}.${B}.${C}.${D}`;
};

// Generate Random Num Function
const getRandomNum = (min, max) => {
  try {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  } catch (error) {
    console.error(error);
  }
  return max;
};

main();

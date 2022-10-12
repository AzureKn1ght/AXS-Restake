/*
- RON Compound - 
This strategy involves claiming farm reward (RON tokens) and swapping the rewards to proportional RON and WETH to create LP tokens and deposit the LP tokens into the farm on the Katana DEX for RON rewards, thereby compounding the daily RON yields. 

URL: https://katana.roninchain.com/#/farm
*/

// Import required node modules
const { ethers, BigNumber } = require("ethers");
const scheduler = require("node-schedule");
const figlet = require("figlet");
require("dotenv").config();
const fs = require("fs");

// Import environment variables
const WALLET_ADDRESS = process.env.USER_ADDRESS;
const PRIV_KEY = process.env.USER_PRIVATE_KEY;
const USER_AGENT = process.env.USER_AGENT;
const RPC_URL = process.env.RONIN_RPC;

// State storage object for claims
var claims = {
  previousClaim: "",
  nextClaim: "",
};

// Contract ABIs
const claimsABI = [
  "function claimPendingRewards()",
  "function getPendingRewards(address) public view returns (uint256)",
];
const katanaABI = [
  "function getAmountsOut(uint, address[]) public view returns (uint[])",
  "function swapExactRONForTokens(uint256, address[], address, uint256) payable",
];
const ronStakerABI = ["function stake(uint256)"];
const erc20ABI = ["function balanceOf(address) view returns (uint256)"];
const lpABI = [
  "function getReserves() external view returns (uint112, uint112, uint32)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
].concat(erc20ABI);

// All relevant addresses needed
const WRON = "0xe514d9deb7966c8be0ca922de8a064264ea6bcd4";
const WETH = "0xc99a6a985ed2cac1ef41640596c5a5f9f4e19ef5";
const LPtoken = "0x2ecb08f87f075b5769fe543d0e52e40140575ea7";
const katanaAdd = "0x7d0556d55ca1a92708681e2e231733ebd922597d";
const claimsAdd = "0xb9072cec557528f81dd25dc474d4d69564956e1e";
const ronStaker = "0xb9072cec557528f81dd25dc474d4d69564956e1e";

// Ethers vars for connections
var wallet,
  provider,
  lpContract,
  wethContract,
  katanaRouter,
  ronFarmContract,
  claimsContract;

// Main Function
const main = async () => {
  try {
    // hello world
    console.log(
      figlet.textSync("RONCompound", {
        font: "Standard",
        horizontalLayout: "default",
        verticalLayout: "default",
        width: 80,
        whitespaceBreak: true,
      })
    );
    let claimsExists = false;

    // get stored values from file
    const storedData = JSON.parse(fs.readFileSync("./claims.json"));

    // not first launch, check data
    if ("nextClaim" in storedData) {
      const nextClaim = new Date(storedData.nextClaim);

      // restore claims schedule
      if (nextClaim > new Date()) {
        console.log("Restored Claim: " + nextClaim);
        scheduler.scheduleJob(nextClaim, RONCompound);
        claimsExists = true;
      }
    }

    //no previous launch
    if (!claimsExists) {
      RONCompound();
    }
  } catch (error) {
    console.error(error);
  }
};

// Ethers vars connect
const connect = async () => {
  const connection = {
    url: RPC_URL,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "X-Forwarded-For": randomIP(),
      "X-Real-Ip": randomIP(),
    },
  };

  // new RPC connection
  provider = new ethers.providers.JsonRpcProvider(connection);
  console.log(connection.headers["X-Forwarded-For"]);
  console.log(connection.headers["X-Real-Ip"]);

  wallet = new ethers.Wallet(PRIV_KEY, provider);
  lpContract = new ethers.Contract(LPtoken, lpABI, wallet);
  wethContract = new ethers.Contract(WETH, erc20ABI, wallet);
  katanaRouter = new ethers.Contract(katanaAdd, katanaABI, wallet);
  claimsContract = new ethers.Contract(claimsAdd, claimsABI, wallet);
  ronFarmContract = new ethers.Contract(ronStaker, ronStakerABI, wallet);

  // connection established
  const balance = await provider.getBalance(WALLET_ADDRESS);
  console.log("RON Balance: " + ethers.utils.formatEther(balance));
  console.log("--> connected\n");
};

// Ethers vars disconnect
const disconnect = () => {
  wallet = null;
  provider = null;
  lpContract = null;
  wethContract = null;
  katanaRouter = null;
  claimsContract = null;
  ronFarmContract = null;
  console.log("-disconnected-\n");
};

// RON Compound Function
const RONCompound = async () => {
  console.log("\n--- RONCompound Start ---");
  try {
    await connect();

    // claim RON rewards, retries 13 times max
    const ronBalance = await claimRONrewards(1);

    // claims failed throw an error exception
    if (!ronBalance) throw "RON claims failed";

    // swap half the RON tokens and create LP
    const LPtokenBal = await addRewardstoLP(ronBalance);

    // stake created LP tokens to farm
    await stakeLPintoFarm(LPtokenBal);

    // end connctions
    return disconnect();
  } catch (error) {
    console.log("RONCompound failed!");

    // try again tomorrow
    console.error(error);
    scheduleNext(new Date());
  }

  return disconnect();
};

// Create LP Function
const addRewardstoLP = async (ronBalance) => {
  try {
    // if somehow the balance did not come thru
    if (!ronBalance) ronBalance = await provider.getBalance(WALLET_ADDRESS);

    // calculate amount to swap for WETH
    ronBalance = BigNumber.from(ronBalance);
    const gas = BigNumber.from(3 * 500000 * 10 ** 9);
    ronBalance.sub(ethers.utils.parseEther("0.025")).sub(gas);
    const formattedBal = Number(ethers.utils.formatEther(ronBalance));
    const amountForWETH = Math.floor((formattedBal / 2) * 100) / 100;

    // swap half of the RON balance to WETH
    const wethBal = await swapRONforWETH(amountForWETH);

    // amount of WETH to add to pool, get the balance if unavailable
    const wethAmt = wethBal || (await wethContract.balanceOf(WALLET_ADDRESS));
    const wethAmtMin = wethAmt.sub(wethAmt.div(100));

    // amount of RON to add to pool
    const LPreserves = await getReserves();
    const ronAmt = quoteAmount(wethAmt, LPreserves);
    const ronAmtMin = ronAmt.sub(ronAmt.div(100));

    console.log("WETH Amount: " + ethers.utils.formatEther(wethAmt));
    console.log("RON Amount: " + ethers.utils.formatEther(ronAmt));

    // msg.value is treated as the amount desired
    const randomGas = getRandomNum(400000, 500000);
    const overrideOptions = {
      gasLimit: randomGas,
      value: ronAmt,
    };

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
  } catch (error) {
    console.error(error);
  }
  return false;
};

// Quote Function
const quoteAmount = (wethAmt, LPreserves) => {
  try {
    // Calculate the quote
    wethAmt = BigInt(wethAmt);
    const ronReserves = BigInt(LPreserves.ronBalance);
    const wethReserves = BigInt(LPreserves.wethBalance);
    const ronAmt = (wethAmt * ronReserves) / wethReserves;

    return BigNumber.from(ronAmt);
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

// Stake Function
const stakeLPintoFarm = async (LPtokenBal) => {
  try {
    // if somehow the balance did not come through
    if (!LPtokenBal) LPtokenBal = await lpContract.balanceOf(WALLET_ADDRESS);

    // set random gasLimit
    const overrideOptions = {
      gasLimit: getRandomNum(400000, 500000),
    };

    // execute LP staking transaction
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

// Swap Function
const swapRONforWETH = async (amount) => {
  try {
    // set gasLimit and swaps path
    const randomGas = getRandomNum(400000, 500000);
    const path = [WRON, WETH];

    // get amount out from katana router
    const amtInFormatted = ethers.utils.formatEther(amount);
    const result = await katanaRouter.getAmountsOut(amount, path);
    const expectedAmt = result[result.length - 1];
    const deadline = Date.now() + 1000 * 60 * 8;

    // calculate max 1% slippage tolerance for ERC20 tokens
    const amountOutMin = expectedAmt.sub(expectedAmt.div(100));
    const amountOut = ethers.utils.formatEther(expectedAmt);

    // set transaction options
    const overrideOptions = {
      gasLimit: randomGas,
      value: amount,
    };

    // execute the RON swapping transaction
    console.log(`Swapping: ${amtInFormatted} RON, For: ~ ${amountOut} WETH`);
    const swap = await katanaRouter.swapExactRONForTokens(
      amountOutMin,
      path,
      WALLET_ADDRESS,
      deadline,
      overrideOptions
    );

    // wait for transaction complete
    const receipt = await swap.wait();
    if (receipt) {
      console.log("RON SWAP SUCCESSFUL");
      const wethBalance = await wethContract.balanceOf(WALLET_ADDRESS);
      return wethBalance;
    }
  } catch (error) {
    console.error(error);
  }

  return false;
};

// Claims Function
const claimRONrewards = async (tries) => {
  try {
    // limit to maximum 13 tries
    if (tries > 13) return false;
    console.log(`Try #${tries}...`);
    console.log("Claiming RON Rewards...");

    // apply delay
    await delay();

    // get pending rewards amount
    const u = await claimsContract.getPendingRewards(WALLET_ADDRESS);
    const unclaimed = ethers.utils.formatEther(u);
    console.log(`Unclaimed Rewards: ${unclaimed} RON`);

    // set random gasLimit
    const overrideOptions = {
      gasLimit: getRandomNum(317811, 514229),
    };

    // execute the RON claiming transaction
    const claim = await claimsContract.claimPendingRewards(overrideOptions);
    const receipt = await claim.wait();

    // wait for transaction to complete
    if (receipt) {
      claims.previousClaim = new Date().toString();
      console.log("RON CLAIM SUCCESSFUL");
      const balance = await provider.getBalance(WALLET_ADDRESS);
      console.log("RON Balance: " + ethers.utils.formatEther(balance));

      // schedule next claim
      scheduleNext(new Date());
      return balance;
    }
  } catch (error) {
    // failed try again
    console.error(error);
    console.log("Claim Attempt Failed!");
    console.log("reconnecting...");
    disconnect();

    // reconnect
    await connect();

    return await claimRONrewards(++tries);
  }

  return false;
};

// Job Scheduler Function
const scheduleNext = async (nextDate) => {
  // set next job to be 24hrs from now
  nextDate.setHours(nextDate.getHours() + 24);

  // add randomized buffer delay
  const d = getRandomNum(1597, 2584);
  nextDate.setSeconds(nextDate.getSeconds() + d);
  claims.nextClaim = nextDate.toString();
  console.log("Next Claim: ", nextDate);

  // schedule next restake
  scheduler.scheduleJob(nextDate, RONCompound);
  storeData();
  return;
};

// Data Storage Function
const storeData = async () => {
  const data = JSON.stringify(claims);
  fs.writeFile("./claims.json", data, (err) => {
    if (err) {
      console.error(err);
    } else {
      console.log("Data stored:\n" + claims);
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

// Generate random num Function
const getRandomNum = (min, max) => {
  try {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  } catch (error) {
    console.error(error);
  }
  return max;
};

// Random Time Delay Function
const delay = () => {
  const ms = getRandomNum(75025, 121393);
  console.log(`delay(${ms})`);
  return new Promise((resolve) => setTimeout(resolve, ms));
};

main();
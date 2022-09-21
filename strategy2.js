/*
- Strategy 2 - 
This strategy involves claiming farm reward (RON tokens) and swapping the RON tokens to AXS and staking it into the AXS staking vault for AXS rewards, thereby creating a farming loop between the LP and AXS farms.

From: https://katana.roninchain.com/#/farm
To: https://stake.axieinfinity.com/
*/

// Import required node modules
const scheduler = require("node-schedule");
const { ethers } = require("ethers");
const figlet = require("figlet");
require("dotenv").config();
const fs = require("fs");

// Import environment variables
const RPC_URL = process.env.RONIN_RPC;
const WALLET_ADDRESS = process.env.USER_ADDRESS;
const USER_AGENT = process.env.USER_AGENT;
const PRIV_KEY = process.env.USER_PRIVATE_KEY;

// State storage object for claims
var claims = {
  previousClaim: "",
  nextClaim: "",
};

// Contract ABIs
const stakingABI = ["function stake(uint256)"];
const claimsABI = ["function claimPendingRewards()"];
const erc20ABI = ["function balanceOf(address) view returns (uint256)"];
const katanaABI = [
  "function swapExactRONForTokens(uint256, address[], address, uint256) payable",
  "function getAmountsOut(uint, address[]) public view returns (uint[])",
];

// All relevant addresses needed
const AXS = "0x97a9107c1793bc407d6f527b77e7fff4d812bece";
const WRON = "0xe514d9deb7966c8be0ca922de8a064264ea6bcd4";
const WETH = "0xc99a6a985ed2cac1ef41640596c5a5f9f4e19ef5";
const katanaAdd = "0x7d0556d55ca1a92708681e2e231733ebd922597d";
const claimsAdd = "0xb9072cec557528f81dd25dc474d4d69564956e1e";
const stakingAdd = "0x05b0bb3c1c320b280501b86706c3551995bc8571";

// Ethers vars for wallet and contract connections
var wallet,
  provider,
  axsContract,
  katanaRouter,
  stakingContract,
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
const connect = () => {
  const connection = {
    url: RPC_URL,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "X-Forwarded-For": randomIP(),
    },
  };

  // new RPC connection
  provider = new ethers.providers.JsonRpcProvider(connection);
  console.log(connection.headers["X-Forwarded-For"]);

  wallet = new ethers.Wallet(PRIV_KEY, provider);
  axsContract = new ethers.Contract(AXS, erc20ABI, wallet);
  katanaRouter = new ethers.Contract(katanaAdd, katanaABI, wallet);
  stakingContract = new ethers.Contract(stakingAdd, stakingABI, wallet);
  claimsContract = new ethers.Contract(claimsAdd, claimsABI, wallet);
  console.log("--> connected\n");
};

// Ethers vars disconnect
const disconnect = () => {
  provider = null;
  wallet = null;
  axsContract = null;
  katanaRouter = null;
  stakingContract = null;
  claimsContract = null;
  console.log("-disconnected-\n");
};

// RON Compound Function
const RONCompound = async () => {
  console.log("--- RONCompound Start ---");
  try {
    // start
    connect();
    const balance = await provider.getBalance(WALLET_ADDRESS);
    console.log("RON Balance: " + ethers.utils.formatEther(balance));

    // claim RON rewards, retries 3 times
    const ronBalance = await claimRONrewards(1);

    // claims failed throw an exception
    if (!ronBalance) throw "RON claims failed";

    // swap the RON rewards for AXS tokens
    const axsBalance = await swapRONforAXS(ronBalance);

    // stake the swapped AXS tokens
    await stakeAXStokens(axsBalance);

    return disconnect();
  } catch (error) {
    console.log("RONCompound failed!");

    // try again tomorrow
    console.error(error);
    scheduleNext(new Date());
  }

  return disconnect();
};

// Stake Function
const stakeAXStokens = async (balance) => {
  try {
    // show current AXS balance
    const formattedBal = ethers.utils.formatEther(balance);
    console.log("AXS Balance: " + formattedBal);

    // set random gasLimit to avoid detection
    const randomGas = getRandomNum(400000, 500000);
    const overrideOptions = {
      gasLimit: randomGas,
    };

    // execute AXS staking transaction
    console.log("Staking AXS Tokens...");
    const stake = await stakingContract.stake(balance, overrideOptions);
    const receipt = await stake.wait();

    // wait for transaction to complete
    if (receipt) {
      console.log("AXS STAKE SUCCESSFUL");
      const ronBal = await provider.getBalance(WALLET_ADDRESS);
      console.log("RON Balance: " + ethers.utils.formatEther(ronBal));
      const axsBal = await axsContract.balanceOf(WALLET_ADDRESS);
      console.log("AXS Balance: " + ethers.utils.formatEther(axsBal));

      return true;
    }
  } catch (error) {
    console.error(error);
  }

  return false;
};

// Swap Function
const swapRONforAXS = async (amount) => {
  try {
    // set gasLimit and value amount
    const randomGas = getRandomNum(400000, 500000);
    const keepRON = ethers.utils.parseEther("0.025");
    const path = [WRON, WETH, AXS];

    // get amount out from katana router
    const amountIn = amount.sub(keepRON).sub(randomGas);
    const amtInFormatted = ethers.utils.formatEther(amountIn);
    const result = await katanaRouter.getAmountsOut(amountIn, path);
    const expectedAmt = result[result.length - 1];
    const deadline = Date.now() + 1000 * 60 * 8;

    // calculate 1% slippage for ERC20 tokens
    const amountOutMin = expectedAmt.sub(expectedAmt.div(100));
    const amountOut = ethers.utils.formatEther(expectedAmt);

    // set transaction options
    const overrideOptions = {
      gasLimit: randomGas,
      value: amountIn,
    };

    // execute the RON swapping transaction
    console.log(`Swapping: ${amtInFormatted} RON, For: ~ ${amountOut} AXS`);
    const swap = await katanaRouter.swapExactRONForTokens(
      amountOutMin,
      path,
      WALLET_ADDRESS,
      deadline,
      overrideOptions
    );

    // wait for transaction to complete
    const receipt = await swap.wait();
    if (receipt) {
      console.log("RON SWAP SUCCESSFUL");
      const axsBalance = await axsContract.balanceOf(WALLET_ADDRESS);
      return axsBalance;
    }
  } catch (error) {
    console.error(error);
  }

  return false;
};

// Claims Function
const claimRONrewards = async (tries) => {
  try {
    // limit to maximum 3 tries
    if (tries > 8) return false;
    console.log(`Try #${tries}...`);
    console.log("Claiming RON Rewards...");

    // set random gasLimit to avoid detection
    const randomGas = getRandomNum(400000, 500000);
    const overrideOptions = {
      gasLimit: Math.floor(randomGas),
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

      // claim successful schedule next
      scheduleNext(new Date());
      return balance;
    }
  } catch (error) {
    // failed try again
    console.error(error);
    console.log("Claim Attempt Failed!");
    console.log("reconnecting...");

    // apply random delay
    await delay();
    
    // refresh the connection
    disconnect();
    connect();

    return await claimRONrewards(++tries);
  }

  return false;
};

// Job Scheduler Function
const scheduleNext = async (nextDate) => {
  // set next job to be 24hrs from now
  nextDate.setHours(nextDate.getHours() + 24);

  // add randomized buffer delay
  const d = getRandomNum(610, 987);
  nextDate.setSeconds(nextDate.getSeconds() + d);
  claims.nextClaim = nextDate.toString();
  console.log("Next Claim: " + nextDate);

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
      console.log("Data stored: \n", claims);
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
  return new Promise((resolve) => setTimeout(resolve, ms));
};

main();

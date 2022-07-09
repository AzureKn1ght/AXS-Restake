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

// Initialize ethers components
const provider = new ethers.getDefaultProvider(
  RPC_URL,
  (request_kwargs = {
    headers: { "content-type": "application/json", "user-agent": USER_AGENT },
  })
);

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

// Setup wallet and contract connections
const wallet = new ethers.Wallet(PRIV_KEY, provider);
const axsContract = new ethers.Contract(AXS, erc20ABI, provider);
const katanaRouter = new ethers.Contract(
  katanaAdd,
  katanaABI,
  provider
).connect(wallet);
const stakingContract = new ethers.Contract(
  stakingAdd,
  stakingABI,
  provider
).connect(wallet);
const claimsContract = new ethers.Contract(
  claimsAdd,
  claimsABI,
  provider
).connect(wallet);

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

    // current ronin balance
    const balance = await provider.getBalance(WALLET_ADDRESS);
    console.log("RON Balance: " + ethers.utils.formatEther(balance));
    let claimsExists = false;

    try {
      // get stored values from file
      const storedData = JSON.parse(fs.readFileSync("./claims.json"));

      // not first launch, check data
      if ("nextClaim" in storedData) {
        const nextClaim = new Date(storedData.nextClaim);
        const currentDate = new Date();

        // restore claims schedule
        if (nextClaim > currentDate) {
          console.log("Restored Claim: " + nextClaim);
          scheduler.scheduleJob(nextClaim, RONCompound);
          claimsExists = true;
        }
      }
    } catch (error) {
      console.error(error);
    }

    //no previous launch
    if (!claimsExists) {
      RONCompound();
    }
  } catch (error) {
    console.error(error);
  }
};

// RON Compound Function
const RONCompound = async () => {
  try {
    // claim RON rewards and swap for AXS
    const balance = await claimRONrewards();
    const swapped = await swapRONforAXS(balance);

    // stake the swapped AXS tokens
    if (swapped) {
      return await stakeAXStokens();
    }
  } catch (error) {
    console.error(error);
  }
  return false;
};

// Stake Function
const stakeAXStokens = async () => {
  try {
    // get current AXS balance
    const balance = await axsContract.balanceOf(WALLET_ADDRESS);
    const formattedBal = ethers.utils.formatEther(balance);
    console.log("AXS Balance: " + formattedBal);

    // reject staking if too small
    if (formattedBal < 0.01) throw "Staking value too small!";

    // set random gasLimit to avoid detection
    const randomGas = getRandomNum(400000, 500000);
    const overrideOptions = {
      gasLimit: Math.floor(randomGas),
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
    // cannot swap if too small
    if (amount < 0.04) throw "Conversion value too small!";

    // set gasLimit and value amount
    const randomGas = getRandomNum(400000, 500000);

    const overrideOptions = {
      gasLimit: randomGas,
      value: amountIn,
    };

    // save some RON tokens for gas
    amount = amount - 0.02 - ethers.utils.formatEther(randomGas);
    const path = [WRON, WETH, AXS];

    // calculate input variables
    const amountIn = ethers.utils.parseEther(amount.toString());
    const result = await katanaRouter.getAmountsOut(amountIn, path);
    const amountOut = Number(ethers.utils.formatEther(result[2])) * 0.99;
    const amountOutMin = ethers.utils.parseEther(amountOut.toString());
    const deadline = Date.now() + 1000 * 60 * 5;

    // execute the RON swapping transaction
    console.log(`Swapping: ${amount} RON, For: ~ ${amountOut} AXS`);
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
      return true;
    }
  } catch (error) {
    console.error(error);
  }
  return false;
};

// Claims Function
const claimRONrewards = async () => {
  try {
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
      let balance = await provider.getBalance(WALLET_ADDRESS);
      balance = ethers.utils.formatEther(balance);
      console.log("RON Balance: " + balance);

      // claim successful schedule next
      scheduleNext(new Date());
      return balance;
    }
  } catch (error) {
    console.error(error);

    // claims failed trying again tomorrow
    console.log("Claims Attempt Failed!");
    console.log("Trying again tomorrow.");
    scheduleNext(new Date());
  }
  return false;
};

// Job Scheduler Function
const scheduleNext = async (nextDate) => {
  // set next job to be 24hrs from now
  nextDate.setHours(nextDate.getHours() + 24);

  // add randomized buffer delay
  const d = getRandomNum(21, 89);
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
      console.log("Data stored: \n" + data);
    }
  });
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

main();

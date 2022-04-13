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

// State storage object for restakes
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
const claimsAdd = "0xd4640c26c1a31cd632d8ae1a96fe5ac135d1eb52";
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

    RONCompound();

    // try {
    //   // get stored values from file
    //   const storedData = JSON.parse(fs.readFileSync("./claims.json"));

    //   // not first launch, check data
    //   if ("nextRestake" in storedData) {
    //     const nextRestake = new Date(storedData.nextRestake);
    //     const currentDate = new Date();

    //     // restore restake schedule
    //     if (nextRestake > currentDate) {
    //       console.log("Restored Restake: " + nextRestake);
    //       scheduler.scheduleJob(nextRestake, restake);
    //       claimsExists = true;
    //     }
    //   }
    // } catch (error) {
    //   console.error(error);
    // }

    // no previous launch data detected
    // if (!claimsExists) {
    //   const firstLaunch = await restake();

    //   // launch failed schedule reattempt
    //   if (!firstLaunch) {
    //     console.log("Launch Restake Failed!");
    //     console.log("Trying again tomorrow");
    //     scheduleNext(new Date());
    //   }
    // }
  } catch (error) {
    console.error(error);
  }
};

// AXS Compound Function
const RONCompound = async () => {
  //const balance = await claimRONrewards();
  //const swapped = await swapRONforAXS(balance);

  const swapped = true;
  if (swapped) {
    stakeAXStokens();
  }
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
    const randomGas = 400000 + (Math.random() * (99999 - 10000) + 10000);
    const overrideOptions = {
      gasLimit: Math.floor(randomGas),
    };

    // execute the AXS staking transaction
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

    // save 0.02 for gas
    amount = amount - 0.02;
    const path = [WRON, WETH, AXS];

    // calculate input variables
    const amountIn = ethers.utils.parseEther(amount.toString());
    const result = await katanaRouter.getAmountsOut(amountIn, path);
    const amountOut = Number(ethers.utils.formatEther(result[2])) * 0.99;
    console.log(`Swapping: ${amount} RON, For: ${amountOut} AXS`);
    const amountOutMin = ethers.utils.parseEther(amountOut.toString());
    const deadline = Date.now() + 1000 * 60 * 5;

    // set gasLimit and value amount
    const randomGas = 400000 + (Math.random() * (99999 - 10000) + 10000);
    const overrideOptions = {
      gasLimit: Math.floor(randomGas),
      value: amountIn,
    };

    // execute the RON swapping transaction
    const claim = await katanaRouter.swapExactRONForTokens(
      amountOutMin,
      path,
      WALLET_ADDRESS,
      deadline,
      overrideOptions
    );

    // wait for transaction to complete
    const receipt = await claim.wait();
    if (receipt) {
      claims.previousClaim = new Date().toString();
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
    const randomGas = 400000 + (Math.random() * (99999 - 10000) + 10000);
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
      return balance;
    }
  } catch (error) {
    console.error(error);
  }
  return false;
};

// Job Scheduler Function
const scheduleNext = async (nextDate) => {
  // set the next restake time (24hrs, 1min, 30sec from now)
  nextDate.setHours(nextDate.getHours() + 24);
  nextDate.setMinutes(nextDate.getMinutes() + 1);
  nextDate.setSeconds(nextDate.getSeconds() + 30);
  restakes.nextRestake = nextDate.toString();
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

main();

const scheduler = require("node-schedule");
const { ethers } = require("ethers");
require("dotenv").config();

// Import environment variables
const RPC_URL = process.env.RONIN_RPC;
const WALLET_ADDRESS = process.env.USER_ADDRESS;
const USER_AGENT = process.env.USER_AGENT;
const PRIV_KEY = process.env.USER_PRIVATE_KEY;

// Initialize ethers components
const provider = new ethers.getDefaultProvider(
  RPC_URL,
  (request_kwargs = {
    headers: { "content-type": "application/json", "user-agent": USER_AGENT },
  })
);

// Staking Contract ABI
const stakingABI = [
  "function restakeRewards()",
  "function claimPendingRewards()",
  "function unstakeAll()",
];

// Setup wallet and contract connections
const contractAddress = "0x05b0bb3c1c320b280501b86706c3551995bc8571";
const contract = new ethers.Contract(contractAddress, stakingABI, provider);
const wallet = new ethers.Wallet(PRIV_KEY, provider);
const connectedContract = contract.connect(wallet);

// Main Function
const main = async () => {
  try {
    // current ronin balance
    const balance = await provider.getBalance(WALLET_ADDRESS);
    console.log("RON Balance: " + ethers.utils.formatEther(balance));

    // get current gas price
    const gas = await provider.getGasPrice();
    console.log("Gas Price: " + ethers.utils.formatEther(gas));

    // first restake on launch
    restake();

    // continues until stopped
  } catch (error) {
    console.error(error);
  }
};

// Restake Function
const restake = async () => {
  try {
    // set random gasLimit to avoid detection
    const randomGas = 400000 + (Math.random() * (99999 - 10000) + 10000);
    const overrideOptions = {
      gasLimit: Math.floor(randomGas),
    };

    // execute the restaking transaction
    const restake = await connectedContract.restakeRewards(overrideOptions);
    const receipt = await restake.wait();

    // wait for transaction to complete
    if (receipt) {
      // restake successful schedule next
      console.log("RESTAKE SUCCESSFUL");
      scheduleNext(new Date());
      return;
    }
  } catch (error) {
    // restake failed try again tomorrow
    console.error(error);
    scheduleNext(new Date());
    return;
  }
};

// Job Scheduler Function
const scheduleNext = async (nextDate) => {
  // set the next restake time (24hrs, 1min, 30sec from now)
  nextDate.setHours(nextDate.getHours() + 24);
  nextDate.setMinutes(nextDate.getMinutes() + 1);
  nextDate.setSeconds(nextDate.getSeconds() + 30); //test just the seconds tmr
  console.log("Next Restake: " + nextDate);

  // schedule next restake
  scheduler.scheduleJob(nextDate, restake);
  return;
};

main();

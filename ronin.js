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
    // hello world
    console.log(
      figlet.textSync("AXSRestake", {
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
    let restakeExists = false;

    try {
      // get stored values from file
      const storedData = JSON.parse(fs.readFileSync("./restakes.json"));

      // not first launch, check data
      if ("nextRestake" in storedData) {
        const nextRestake = new Date(storedData.nextRestake);
        const currentDate = new Date();

        // restore restake schedule
        if (nextRestake > currentDate) {
          console.log("Restored Restake: " + nextRestake);
          scheduler.scheduleJob(nextRestake, restake);
          restakeExists = true;
        }
      }
    } catch (error) {
      console.error(error);
    }

    // no previous launch
    if (!restakeExists) {
      restake();
    }
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
      restakes.previousRestake = new Date().toString();
      console.log("RESTAKE SUCCESSFUL");
      scheduleNext(new Date());

      return true;
    }
  } catch (error) {
    console.error(error);

    // restake failed try again tomorrow
    console.log("Restake Attempt Failed!");
    console.log("Trying again tomorrow.");
    scheduleNext(new Date());
  }
  return false;
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

// Job Scheduler Function
const scheduleNext = async (nextDate) => {
  // set the next restake time (24hrs, 1min, 30sec from now)
  nextDate.setHours(nextDate.getHours() + 24);
  nextDate.setMinutes(nextDate.getMinutes() + 1);
  nextDate.setSeconds(nextDate.getSeconds() + 30);
  restakes.nextRestake = nextDate.toString();
  console.log("Next Restake: " + nextDate);

  // schedule next restake
  scheduler.scheduleJob(nextDate, restake);
  storeData();
  return;
};

main();

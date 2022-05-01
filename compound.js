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

// All relevant addresses needed
const AXS = "0x97a9107c1793bc407d6f527b77e7fff4d812bece";
const SLP = "0xa8754b9fa15fc18bb59458815510e40a12cd2014";
const WETH = "0xc99a6a985ed2cac1ef41640596c5a5f9f4e19ef5";
const katanaDEX = "0x7d0556d55ca1a92708681e2e231733ebd922597d";
const axsStaker = "0x05b0bb3c1c320b280501b86706c3551995bc8571";
const slpStaker = "0xd4640c26c1a31cd632d8ae1a96fe5ac135d1eb52";

// Contract ABIs
const slpStakerABI = ["function stake(uint256)"];
const axsStakerABI = ["function claimPendingRewards()"];
const erc20ABI = ["function balanceOf(address) view returns (uint256)"];
const katanaDEX_ABI = [
  "function getAmountsOut(uint, address[]) public view returns (uint[])",
  "function swapExactRONForTokens(uint256, address[], address, uint256) payable",
  "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
  "function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)",
];

// Function:swapExactTokensForTokens(uint256,uint256,address[],address,uint256)
// Arguments:
// [0]-[_amountIn]: 4083
// [1]-[_amountOutMin]: 17672354712425148
// [2]-[_path]: ["0xa8754b9fa15fc18bb59458815510e40a12cd2014","0xc99a6a985ed2cac1ef41640596c5a5f9f4e19ef5"]
// [3]-[_to]: 0x881e1143f253d9a3e9fa1836294f65700ce21246
// [4]-[_deadline]: 1651314539

// Function:addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)
// Arguments:
// [0]-[_tokenA]: 0xa8754b9fa15fc18bb59458815510e40a12cd2014
// [1]-[_tokenB]: 0xc99a6a985ed2cac1ef41640596c5a5f9f4e19ef5
// [2]-[_amountADesired]: 4080
// [3]-[_amountBDesired]: 17800954259961063
// [4]-[_amountAMin]: 4059
// [5]-[_amountBMin]: 17711949488661258
// [6]-[_to]: 0x881e1143f253d9a3e9fa1836294f65700ce21246
// [7]-[_deadline]: 1651314566

// Setup wallet and contract connections
const wallet = new ethers.Wallet(PRIV_KEY, provider);
const axsContract = new ethers.Contract(AXS, erc20ABI, provider);
const slpContract = new ethers.Contract(SLP, erc20ABI, provider);
const katanaRouter = new ethers.Contract(katanaDEX, katanaDEX_ABI, wallet);
const slpFarmContract = new ethers.Contract(slpStaker, slpStakerABI, wallet);
const axsRewardsContract = new ethers.Contract(axsStaker, axsStakerABI, wallet);

// Main Function
const main = async () => {
  // try {
  //   // hello world
  //   console.log(
  //     figlet.textSync("AXSCompound", {
  //       font: "Standard",
  //       horizontalLayout: "default",
  //       verticalLayout: "default",
  //       width: 80,
  //       whitespaceBreak: true,
  //     })
  //   );
  //   // current ronin balance
  //   const balance = await provider.getBalance(WALLET_ADDRESS);
  //   console.log("RON Balance: " + ethers.utils.formatEther(balance));
  //   let claimsExists = false;
  //   try {
  //     // get stored values from file
  //     const storedData = JSON.parse(fs.readFileSync("./restakes.json"));
  //     // not first launch, check data
  //     if ("nextRestake" in storedData) {
  //       const nextRestake = new Date(storedData.nextRestake);
  //       const currentDate = new Date();
  //       // restore claims schedule
  //       if (nextRestake > currentDate) {
  //         console.log("Restored Claim: " + nextRestake);
  //         scheduler.scheduleJob(nextRestake, AXSCompound);
  //         claimsExists = true;
  //       }
  //     }
  //   } catch (error) {
  //     console.error(error);
  //   }
  //   //no previous launch
  //   if (!claimsExists) {
  //     AXSCompound();
  //   }
  // } catch (error) {
  //   console.error(error);
  // }
};

// AXS Compound Function
const AXSCompound = async () => {
  // ALGORITHM
  // 1. Claim pending AXS rewards
  //  2a. Swap half into SLP tokens
  //  2b. Swap other half into WETH
  //  2c. Add tokens to the LP Pool
  // 3. Stake LP tokens into farm

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

// Stake Function
const stakeLPintoFarm = async () => {
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
const addRewardstoLP = async (amount) => {
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
    const amountOutMin = ethers.utils.parseEther(amountOut.toString());
    const deadline = Date.now() + 1000 * 60 * 5;

    // set gasLimit and value amount
    const randomGas = 400000 + (Math.random() * (99999 - 10000) + 10000);
    const overrideOptions = {
      gasLimit: Math.floor(randomGas),
      value: amountIn,
    };

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
const claimAXSrewards = async () => {
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
      restakes.previousRestake = new Date().toString();
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

main();

/*
- RON Compound - 
This strategy involves claiming farm rewards (RON tokens) and swapping the rewards to proportional RON and USDC to create LP tokens and deposit the LP tokens into the farm on the Katana DEX for more RON rewards, thereby compounding the daily RON yields. Staking in the USDC based LP to also do partial take profits. 

URL: https://katana.roninchain.com/#/farm
*/

// Import required node modules
const { ethers, BigNumber } = require("ethers");
const scheduler = require("node-schedule");
const nodemailer = require("nodemailer");
const figlet = require("figlet");
require("dotenv").config();
const fs = require("fs");

// Import environment variables
const WALLET_ADDRESS = process.env.USER_ADDRESS;
const PRIV_KEY = process.env.USER_PRIVATE_KEY;
const USER_AGENT = process.env.USER_AGENT;
const RPC_URL = process.env.RONIN_RPC;

// State storage object for claims
var report = [];
var claims = {
  previousClaim: "",
  nextClaim: "",
};

// Contract ABIs
const erc20ABI = ["function balanceOf(address) view returns (uint256)"];
const lpABI = require("./ABI/liquidityPoolABI");
const claimsABI = require("./ABI/stakingABI");
const katanaABI = require("./ABI/katanaABI");
const ronStakerABI = claimsABI;

// All relevant addresses needed
const WRON = "0xe514d9deb7966c8be0ca922de8a064264ea6bcd4";
const WETH = "0xc99a6a985ed2cac1ef41640596c5a5f9f4e19ef5";
const USDC = "0x0b7007c13325c48911f73a2dad5fa5dcbf808adc";
const katanaAdd = "0xc05afc8c9353c1dd5f872eccfacd60fd5a2a9ac7"; //Address changed
const claimsAdd = "0xb9072cec557528f81dd25dc474d4d69564956e1e"; //For RON-WETH LP
const usdcFarm = "0xba1c32baff8f23252259a641fd5ca0bd211d4f65"; //For RON-USDC LP
const usdcLP = "0x4f7687affc10857fccd0938ecda0947de7ad3812"; //For RON-USDC LP

// Ethers vars for connections
var wallet,
  provider,
  errorLog,
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

    // check if claims file exists
    if (!fs.existsSync("./claims.json")) await storedData();

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
  lpContract = new ethers.Contract(usdcLP, lpABI, wallet); //Changed this to USDC
  wethContract = new ethers.Contract(WETH, erc20ABI, wallet);
  usdcContract = new ethers.Contract(USDC, erc20ABI, wallet);
  katanaRouter = new ethers.Contract(katanaAdd, katanaABI, wallet);
  claimsContract = new ethers.Contract(claimsAdd, claimsABI, wallet);
  ronFarmContract = new ethers.Contract(usdcFarm, ronStakerABI, wallet); //Changed this to USDC

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
  report.push("--- RONCompound Report ---");
  try {
    await connect();
    errorLog = [];

    // claim RON rewards, retries 8 times max
    const ronBalance = await claimRONrewards();

    // swap half the RON tokens and create LP
    const LPtokenBal = await addRewardstoLP(ronBalance);

    // stake created LP tokens to farm
    const staked = await stakeLPintoFarm(LPtokenBal);

    // function status
    const compound = {
      claimRONrewards: ronBalance > 0,
      addRewardstoLP: LPtokenBal > 0,
      stakeLPintoFarm: staked,
    };

    report.push(compound);
    report.push(errorLog);
  } catch (error) {
    report.push("RONCompound failed!");
    report.push(error);

    // try again tomorrow
    console.error(error);
    scheduleNext(new Date());
  }

  // send status update report
  report.push({ ...claims });
  sendReport(report);
  report = [];

  return disconnect();
};

// Create LP Function
const addRewardstoLP = async (ronBalance, tries = 1) => {
  try {
    // limit to maximum 8 tries
    if (tries > 8) return false;
    console.log(`Try #${tries}...`);
    console.log("Adding Liquidity...");
    console.log(ronBalance.toString());

    // if there is existing usdc, swap all to RON first
    const usdcBalance = await usdcContract.balanceOf(WALLET_ADDRESS);
    if (usdcBalance.gt(0)) {
      const path = [USDC, WRON];
      report.push({ usdc: usdcBalance.gt(0) });
      await swapExactTokensForRON(usdcBalance, path, tries);
    }
    ronBalance = await provider.getBalance(WALLET_ADDRESS);

    // calculate RON to keep
    const gasUsage = ethers.utils.parseUnits("20000000", "gwei");
    const keepRON = ethers.utils.parseUnits("0.02", "ether");
    ronBalance = ronBalance.sub(keepRON).sub(gasUsage);

    // calculate amount of RON to be swapped for USDC
    const formattedBal = Number(ethers.utils.formatEther(ronBalance));
    let amountForUSDC = Math.floor((formattedBal / 2) * 1000) / 1000;
    amountForUSDC = ethers.utils.parseEther(amountForUSDC.toString());

    // swap half of the RON to USDC and get the balance
    let usdcAmt = await swapRONforTokens(amountForUSDC, [WRON, USDC], tries);
    usdcAmt = await usdcContract.balanceOf(WALLET_ADDRESS);
    const usdcAmtMin = usdcAmt.sub(usdcAmt.div(100));

    // amount of RON to add to pool
    const LPreserves = await getReserves();
    const ronAmt = quoteAmount(usdcAmt, LPreserves);
    const ronAmtMin = ronAmt.sub(ronAmt.div(100));

    console.log("USDC Amount: " + ethers.utils.formatEther(usdcAmt));
    console.log("RON Amount: " + ethers.utils.formatEther(ronAmt));

    const price = (19 + tries).toString();

    // msg.value is amt desired
    const overrideOptions = {
      gasPrice: ethers.utils.parseUnits(price, "gwei").toString(),
      gasLimit: randomGas(),
      value: ronAmt,
    };

    // add amounts into liquidity pool
    const deadline = Date.now() + 1000 * 60 * 8;
    const addLiquidity = await katanaRouter.addLiquidityRON(
      USDC,
      usdcAmt,
      usdcAmtMin,
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
      ronBalance = await provider.getBalance(WALLET_ADDRESS);
      const formatted = ethers.utils.formatEther(ronBalance);

      // push report
      const addLiquidity = {
        addRewardstoLP: true,
        startingRON: formattedBal,
        usdcAmt: ethers.utils.formatEther(usdcAmt),
        ronAmt: ethers.utils.formatEther(ronAmt),
        lpBal: ethers.utils.formatEther(lpBal),
        endingRON: formatted,
        tries: tries,
      };
      report.push(addLiquidity);
      return lpBal;
    }
  } catch (error) {
    // failed disconnect
    console.error(error);
    console.log("Add Liquidity Failed!");
    console.log("reconnecting...");
    disconnect();

    //errorLog.push(error); //for debug

    // try again
    await delay();
    await connect();
    return await addRewardstoLP(ronBalance, ++tries);
  }
  return false;
};

// Quote Function
const quoteAmount = (tknAmt, LPreserves) => {
  try {
    // Calculate the quote
    tknAmt = BigInt(tknAmt);
    const ronReserves = BigInt(LPreserves.ronBalance);
    const tknReserves = BigInt(LPreserves.tknBalance);
    const ronAmt = (tknAmt * ronReserves) / tknReserves;

    // Calculate current price
    const ratio = ronReserves / tknReserves;
    const priceBN = BigNumber.from(ratio);
    const p = ethers.utils.formatEther(priceBN);
    report.push({ price: p });

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
    let balances = { ronBalance: 0, tknBalance: 0 };
    if (WRON.toLowerCase() === token0.toLowerCase()) {
      balances.ronBalance = LPreserves[0];
      balances.tknBalance = LPreserves[1];
    } else {
      balances.ronBalance = LPreserves[1];
      balances.tknBalance = LPreserves[0];
    }

    return balances;
  } catch (error) {
    console.error(error);
    console.log("Failed to get reserves.");
  }
  return false;
};

// Stake Function
const stakeLPintoFarm = async (LPtokenBal, tries = 1) => {
  try {
    // limit to maximum 8 tries
    if (tries > 8) return false;
    console.log(`Try #${tries}...`);
    console.log("Staking Liquidity...");
    console.log(LPtokenBal.toString());

    // if somehow the balance did not come through
    if (!LPtokenBal) LPtokenBal = await lpContract.balanceOf(WALLET_ADDRESS);

    const price = (19 + tries).toString();

    // set random gasLimit
    const overrideOptions = {
      gasPrice: ethers.utils.parseUnits(price, "gwei").toString(),
      gasLimit: randomGas(),
    };

    // execute LP staking transaction
    console.log("Staking LP Tokens...");
    const stake = await ronFarmContract.stake(LPtokenBal, overrideOptions);
    const receipt = await stake.wait();

    // wait for transaction to complete
    if (receipt) {
      console.log("LP STAKE SUCCESSFUL");
      const balance = await lpContract.balanceOf(WALLET_ADDRESS);

      // push report
      const stake = {
        stakeLPintoFarm: true,
        startingLP: ethers.utils.formatEther(LPtokenBal),
        endingLP: ethers.utils.formatEther(balance),
        tries: tries,
      };
      report.push(stake);
      return true;
    }
  } catch (error) {
    // failed disconnect
    console.error(error);
    console.log("Stake Liquidity Failed!");
    console.log("reconnecting...");
    disconnect();

    errorLog.push(error);

    // try again
    await delay();
    await connect();
    return await stakeLPintoFarm(LPtokenBal, ++tries);
  }
  return false;
};

// Swap Function
const swapRONforTokens = async (amount, path, tries = 1) => {
  try {
    // get amount out from katana router
    const amtInFormatted = ethers.utils.formatEther(amount);
    const result = await katanaRouter.getAmountsOut(amount, path);
    const expectedAmt = result[result.length - 1];
    const deadline = Date.now() + 1000 * 60 * 8;

    // calculate max 1% slippage tolerance for ERC20 tokens
    const amountOutMin = expectedAmt.sub(expectedAmt.div(100));
    const amountOut = ethers.utils.formatEther(expectedAmt);

    const price = (19 + tries).toString();

    // set transaction options
    const overrideOptions = {
      gasPrice: ethers.utils.parseUnits(price, "gwei").toString(),
      gasLimit: randomGas(),
      value: amount,
    };

    // execute the RON swapping transaction
    console.log(`Swapping: ${amtInFormatted} RON, For: ~ ${amountOut}`);
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
      return true;
    }
  } catch (error) {
    console.error(error);
    errorLog.push(error); //for debug
  }

  return false;
};

// Swap Function (Not Used)
const swapRONforWETH = async (amount) => {
  try {
    // set swaps path
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
      gasLimit: randomGas(),
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

// Swaps Function
const swapExactTokensForRON = async (amountIn, path, tries = 1) => {
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
    console.log("Amount In: " + amtInFormatted);
    console.log("Amount Out: " + amountOut);
    let swap;

    const price = (19 + tries).toString();

    // set random gasLimit
    const overrideOptions = {
      gasPrice: ethers.utils.parseUnits(price, "gwei").toString(),
      gasLimit: randomGas(),
    };

    // execute the swap using the appropriate function
    swap = await katanaRouter.swapExactTokensForRON(
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
    errorLog.push(error); //for debug
  }
  return false;
};

// Claims Function
const claimRONrewards = async () => {
  try {
    // execute claiming from the 2 farms
    const usdcPool = await claimUSDCpool();
    const wethPool = await claimWETHpool();

    // wait transaction to complete plan next
    claims.previousClaim = new Date().toString();
    console.log("RON CLAIMS SUCCESSFUL");
    const balance = await provider.getBalance(WALLET_ADDRESS);
    const formatted_bal = ethers.utils.formatEther(balance);
    console.log("RON Balance: " + formatted_bal);

    // push report
    const claim = {
      claimRONrewards: true,
      claimUSDCpool: usdcPool,
      claimWETHpool: wethPool,
      ronBalance: formatted_bal,
    };
    report.push(claim);

    // schedule next claim
    scheduleNext(new Date());
    return balance;
  } catch (error) {
    // failed disconnect
    console.error(error);
    console.log("Claim Failed!");
  }
  return false;
};

// Claims Function Part 2
const claimUSDCpool = async (tries = 1) => {
  try {
    // limit to maximum 8 tries
    if (tries > 8) return false;
    console.log(`Try #${tries}...`);
    console.log("Claiming USDC-RON Rewards...");

    // get pending rewards amount
    const u = await ronFarmContract.getPendingRewards(WALLET_ADDRESS);
    const unclaimed = ethers.utils.formatEther(u);
    console.log(`Unclaimed Rewards: ${unclaimed} RON`);

    const price = (19 + tries).toString();

    // set random gasLimit
    const overrideOptions = {
      gasPrice: ethers.utils.parseUnits(price, "gwei").toString(),
      gasLimit: randomGas(),
    };

    // execute the RON claiming transaction
    const claim = await ronFarmContract.claimPendingRewards(overrideOptions);
    const receipt = await claim.wait();

    // wait for transaction to complete
    if (receipt) {
      console.log("USDC-RON CLAIM SUCCESSFUL");

      // push report
      const claim = {
        claimUSDCpool: true,
        rewardsClaimed: unclaimed,
        tries: tries,
      };

      return claim;
    }
  } catch (error) {
    // failed disconnect
    console.error(error);
    console.log("Claim Attempt Failed!");
    console.log("reconnecting...");
    disconnect();

    //errorLog.push(error); //for debug

    // try again...
    await delay();
    await connect();
    return await claimUSDCpool(++tries);
  }

  return false;
};

// Claims Function Part 1
const claimWETHpool = async (tries = 1) => {
  try {
    // limit to maximum 8 tries
    if (tries > 8) return false;
    console.log(`Try #${tries}...`);
    console.log("Claiming WETH-RON Rewards...");

    // get pending rewards amount
    const u = await claimsContract.getPendingRewards(WALLET_ADDRESS);
    const unclaimed = ethers.utils.formatEther(u);
    console.log(`Unclaimed Rewards: ${unclaimed} RON`);

    const price = (19 + tries).toString();

    // set random gasLimit
    const overrideOptions = {
      gasPrice: ethers.utils.parseUnits(price, "gwei").toString(),
      gasLimit: randomGas(),
    };

    // execute the RON claiming transaction
    const claim = await claimsContract.claimPendingRewards(overrideOptions);
    const receipt = await claim.wait();

    // wait for transaction to complete
    if (receipt) {
      console.log("WETH-RON CLAIM SUCCESSFUL");

      // push report
      const claim = {
        claimWETHpool: true,
        rewardsClaimed: unclaimed,
        tries: tries,
      };

      return claim;
    }
  } catch (error) {
    // failed disconnect
    console.error(error);
    console.log("Claim Attempt Failed!");
    console.log("reconnecting...");
    disconnect();

    //errorLog.push(error); //for debug

    // try again...
    await delay();
    await connect();
    return await claimWETHpool(++tries);
  }

  return false;
};

// Send Report Function
const sendReport = (report) => {
  // get the formatted date
  const today = todayDate();
  report.push(errorLog);
  console.log(report);

  // configure email server
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_ADDR,
      pass: process.env.EMAIL_PW,
    },
  });

  // setup mail params
  const mailOptions = {
    from: process.env.EMAIL_ADDR,
    to: process.env.RECIPIENT,
    subject: "Ronin Report: " + today,
    text: JSON.stringify(report, null, 2),
  };

  // send the email message
  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.log(error);
    } else {
      console.log("Email sent: " + info.response);
    }
  });
};

// Current Date Function
const todayDate = () => {
  const today = new Date();
  return today.toLocaleString("en-GB", { timeZone: "Asia/Singapore" });
};

// Job Scheduler Function
const scheduleNext = async (nextDate) => {
  // apply delay
  await delay();

  // set next job to be 24hrs from now
  nextDate.setHours(nextDate.getHours() + 24);
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
      console.log("Data stored:\n", claims);
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

// Generate random gas Function
const randomGas = () => {
  return getRandomNum(1049897, 1285607);
};

// Random Time Delay Function
const delay = () => {
  const ms = getRandomNum(196418, 317811);
  console.log(`delay(${ms})`);
  return new Promise((resolve) => setTimeout(resolve, ms));
};

main();

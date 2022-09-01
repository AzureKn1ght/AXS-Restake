/*
- test.js - 
TEST FILE FOR TRYING OUT NEW CODE

https://ethereum.stackexchange.com/questions/96806/is-connectioninfo-class-in-ehters-5-x
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
      figlet.textSync("TEST", {
        font: "Standard",
        horizontalLayout: "default",
        verticalLayout: "default",
        width: 80,
        whitespaceBreak: true,
      })
    );

    // start
        console.log("--- AXSCompound Start ---");

    connect();
    const balance = await provider.getBalance(WALLET_ADDRESS);
    console.log("RON Balance: " + ethers.utils.formatEther(balance));

    const axsBal = await axsContract.balanceOf(WALLET_ADDRESS);
    console.log("AXS Balance: " + ethers.utils.formatEther(axsBal));

    console.log(provider);
    disconnect();
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

  provider = new ethers.providers.JsonRpcProvider(connection);
  console.log(connection);

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

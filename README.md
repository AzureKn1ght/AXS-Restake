# AXS Restake
![Axie Infinity](https://assets-global.website-files.com/606f63778ec431ec1b930f1f/6179592286d0189864185a6d_afkgaming-2021-07-1b98241e-ef6c-41a9-8593-656d27c77c85-axie_cover.jpg)
Simple Bot to Restake tokens every 24h on Ronin chain. Creating compound interest with RON and AXS tokens. 

## Strategy 1
This strategy involves claiming the rewards (AXS tokens) and swapping the AXS tokens to RON and WETH to create LP tokens and deposit the LP tokens into the farm on the Katana DEX for RON rewards, thereby compounding the daily RON yields. 

From: https://stake.axieinfinity.com/ \
To: https://katana.roninchain.com/#/farm

## Strategy 2
This strategy involves claiming farm rewards (RON tokens) and swapping the RON tokens to AXS and staking it into the AXS staking vault for AXS rewards, thereby creating a farming loop between the LP and AXS farms.

From: https://katana.roninchain.com/#/farm \
To: https://stake.axieinfinity.com/


# ENV Variables 
You will need to create a file called *.env* in the root directory, copy the text in *.env.example* and fill in the variables 


# How to Run 
You could run it on your desktop just using [Node.js](https://github.com/nodejs/node) in your terminal. However, on a production environment, it is recommended to use something like [PM2](https://github.com/Unitech/pm2) to run the processes to ensure robust uptime and management. 
```
npm install
pm2 start strategy1.js -n "AXS"
pm2 start strategy2.js -n "RON"
pm2 save

```

### RON Compound
```
pm2 start RONcompound.js -n "RON"
pm2 save

```

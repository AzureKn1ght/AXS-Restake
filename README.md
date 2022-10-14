# AXS Restake
Simple Bot to Restake tokens every 24h on Ronin chain. Creating compound interest with RON and AXS tokens. 
![Axie Infinity](https://oganiza.com/wp-content/uploads/2021/07/https___bucketeer-e05bbc84-baa3-437e-9518-adb32be77984.s3.amazonaws.com_public_images_53c0b5af-ffd1-41fc-acbf-6e21fffd6885_1736x807-1536x714.png)

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

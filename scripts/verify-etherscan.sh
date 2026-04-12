#!/bin/bash

if [ -z "$ETHERSCAN_API_KEY" ]; then
  echo "Error: ETHERSCAN_API_KEY not set. Export it or add to .env"
  exit 1
fi

echo "Verifying Wadoozie Token..."
npx hardhat verify --network sepolia \
  --contract contracts/Wadoozie.sol:Wadoozie \
  0xc8A46F5ff702e496de6E14E138488dfc33FF6761 \
  "0xC4bB342BC67A77B9Ce591E32F3D453B240EA4E63"

echo -e "\nVerifying Headquarters..."
npx hardhat verify --network sepolia \
  --contract contracts/Headquarters.sol:Headquarters \
  0x9A5c6aF405CF6830356d08Ad3a3BA73A7A9b4918 \
  "0xc8A46F5ff702e496de6E14E138488dfc33FF6761" \
  "0x5800bf5aE75549A3FcF050BF7e46aC859917325e" \
  "7200" "50400" "0" "4"

echo -e "\nDone!"

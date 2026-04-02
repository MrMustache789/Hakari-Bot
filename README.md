# 🎰 Discord Gambling Bot

Virtual currency gambling bot with slots, blackjack, roulette, coinflip, and dice.

## Setup

1. Create a bot at https://discord.com/developers/applications
2. Copy your bot token
3. Fill in `.env`:
   ```
   TOKEN=your_bot_token_here
   ADMIN_ID=your_discord_user_id_here  ← right-click yourself in Discord > Copy User ID
   ```
4. Install dependencies: `npm install`
5. Run: `node index.js`

## Commands

| Command | Description |
|---|---|
| `/balance` | Check your coin balance |
| `/daily` | Claim 1–5000 coins (once per 24h) |
| `/slots <bet>` | Spin the slots |
| `/blackjack <bet>` | Play blackjack |
| `/roulette <bet> <choice>` | Bet on red/black/green/odd/even or a number (0-36) |
| `/coinflip <bet> <heads/tails>` | Flip a coin |
| `/dice <bet> <guess>` | Guess a dice roll (1-6) for 5x payout |
| `/leaderboard` | Top 10 richest users |

## Admin Commands (your ID only)

| Command | Description |
|---|---|
| `/setbalance <user> <amount>` | Set someone's balance |
| `/setstartingbalance <amount>` | Change starting balance for new users |
| `/givemoney <user> <amount>` | Give or take coins (negative to take) |

## Hosting on Railway

1. Push this folder to GitHub (exclude .env — Railway uses environment variables)
2. Go to railway.app → New Project → Deploy from GitHub
3. Add environment variables: TOKEN and ADMIN_ID
4. Deploy

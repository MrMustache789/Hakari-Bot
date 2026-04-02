require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const fs = require('fs');

const DB_FILE = './db.json';
const CONFIG_FILE = './config.json';

// ─── Database helpers ────────────────────────────────────────────────────────
function loadDB() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }));
  return JSON.parse(fs.readFileSync(DB_FILE));
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    const defaults = { starting_balance: 1000, admin_id: process.env.ADMIN_ID || '' };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE));
}
function getUser(userId) {
  const db = loadDB();
  const config = loadConfig();
  if (!db.users[userId]) {
    db.users[userId] = { balance: config.starting_balance, lastDaily: null };
    saveDB(db);
  }
  return db.users[userId];
}
function setBalance(userId, amount) {
  const db = loadDB();
  if (!db.users[userId]) db.users[userId] = { balance: amount, lastDaily: null };
  else db.users[userId].balance = amount;
  saveDB(db);
}

// ─── Games ───────────────────────────────────────────────────────────────────
function playSlots(bet) {
  const symbols = ['🍒', '🍋', '🍊', '🍇', '💎', '7️⃣'];
  const weights =  [30,   25,   20,   15,   7,    3  ];
  function spin() {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < symbols.length; i++) { r -= weights[i]; if (r <= 0) return symbols[i]; }
    return symbols[0];
  }
  const reels = [spin(), spin(), spin()];
  const display = reels.join(' | ');
  let multiplier = 0;
  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    if (reels[0] === '7️⃣') multiplier = 20;
    else if (reels[0] === '💎') multiplier = 10;
    else if (reels[0] === '🍇') multiplier = 5;
    else multiplier = 3;
  } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
    multiplier = 1.5;
  }
  const winnings = Math.floor(bet * multiplier);
  return { display, winnings, multiplier };
}

function playBlackjack(bet) {
  const deck = [];
  ['♠','♥','♦','♣'].forEach(s => {
    ['A','2','3','4','5','6','7','8','9','10','J','Q','K'].forEach(v => deck.push({ s, v }));
  });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  function cardVal(c) {
    if (['J','Q','K'].includes(c.v)) return 10;
    if (c.v === 'A') return 11;
    return parseInt(c.v);
  }
  function handVal(hand) {
    let val = hand.reduce((s, c) => s + cardVal(c), 0);
    let aces = hand.filter(c => c.v === 'A').length;
    while (val > 21 && aces > 0) { val -= 10; aces--; }
    return val;
  }
  function fmt(hand) { return hand.map(c => c.v + c.s).join(' '); }

  const playerHand = [deck.pop(), deck.pop()];
  const dealerHand = [deck.pop(), deck.pop()];

  // Simple AI: dealer hits until 17
  while (handVal(dealerHand) < 17) dealerHand.push(deck.pop());

  const pv = handVal(playerHand);
  const dv = handVal(dealerHand);
  let result, winnings;

  if (pv === 21 && playerHand.length === 2) {
    result = '🎉 Blackjack!'; winnings = Math.floor(bet * 2.5);
  } else if (pv > 21) {
    result = '💥 Bust!'; winnings = 0;
  } else if (dv > 21 || pv > dv) {
    result = '✅ You win!'; winnings = bet * 2;
  } else if (pv === dv) {
    result = '🤝 Push!'; winnings = bet;
  } else {
    result = '❌ Dealer wins!'; winnings = 0;
  }

  return {
    playerCards: fmt(playerHand), playerVal: pv,
    dealerCards: fmt(dealerHand), dealerVal: dv,
    result, winnings
  };
}

function playRoulette(bet, choice) {
  const num = Math.floor(Math.random() * 37); // 0-36
  const reds = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
  const isRed = reds.includes(num);
  const color = num === 0 ? 'green' : (isRed ? 'red' : 'black');
  let winnings = 0;
  let hit = false;

  const c = choice.toLowerCase();
  if (c === 'red' && isRed) { hit = true; winnings = bet * 2; }
  else if (c === 'black' && !isRed && num !== 0) { hit = true; winnings = bet * 2; }
  else if (c === 'green' && num === 0) { hit = true; winnings = bet * 14; }
  else if (c === 'odd' && num !== 0 && num % 2 !== 0) { hit = true; winnings = bet * 2; }
  else if (c === 'even' && num !== 0 && num % 2 === 0) { hit = true; winnings = bet * 2; }
  else if (!isNaN(parseInt(c)) && parseInt(c) === num) { hit = true; winnings = bet * 35; }

  const emoji = color === 'red' ? '🔴' : color === 'black' ? '⚫' : '🟢';
  return { num, color, emoji, hit, winnings };
}

function playCoinFlip(bet, choice) {
  const result = Math.random() < 0.5 ? 'heads' : 'tails';
  const win = choice.toLowerCase() === result;
  return { result, win, winnings: win ? bet * 2 : 0, emoji: result === 'heads' ? '🪙' : '🟤' };
}

function playDice(bet, guess) {
  const roll = Math.floor(Math.random() * 6) + 1;
  const win = guess === roll;
  return { roll, win, winnings: win ? bet * 5 : 0 };
}

// ─── Commands ─────────────────────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder().setName('balance').setDescription('Check your balance'),
  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily coins (1–5000)'),
  new SlashCommandBuilder().setName('slots')
    .setDescription('Play slots')
    .addIntegerOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('blackjack')
    .setDescription('Play blackjack')
    .addIntegerOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('roulette')
    .setDescription('Bet on red/black/green/odd/even or a number (0-36)')
    .addIntegerOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('choice').setDescription('red/black/green/odd/even or a number').setRequired(true)),
  new SlashCommandBuilder().setName('coinflip')
    .setDescription('Flip a coin')
    .addIntegerOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('choice').setDescription('heads or tails').setRequired(true)),
  new SlashCommandBuilder().setName('dice')
    .setDescription('Guess a dice roll (1-6) for 5x payout')
    .addIntegerOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName('guess').setDescription('Your guess (1-6)').setRequired(true).setMinValue(1).setMaxValue(6)),
  // Admin commands
  new SlashCommandBuilder().setName('setbalance')
    .setDescription('[ADMIN] Set a user\'s balance')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('New balance').setRequired(true).setMinValue(0)),
  new SlashCommandBuilder().setName('setstartingbalance')
    .setDescription('[ADMIN] Set the default starting balance for new users')
    .addIntegerOption(o => o.setName('amount').setDescription('Starting balance').setRequired(true).setMinValue(0)),
  new SlashCommandBuilder().setName('givemoney')
    .setDescription('[ADMIN] Give or take money from a user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount (negative to take)').setRequired(true)),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Show the top 10 richest users'),
].map(c => c.toJSON());

// ─── Bot setup ────────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Slash commands registered globally');
  } catch (e) { console.error(e); }
});

function isAdmin(userId) {
  const config = loadConfig();
  return userId === config.admin_id;
}

function embed(title, description, color = 0x2b2d31) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, user } = interaction;

  // Admin guard
  const adminCmds = ['setbalance', 'setstartingbalance', 'givemoney'];
  if (adminCmds.includes(commandName) && !isAdmin(user.id)) {
    return interaction.reply({ embeds: [embed('❌ Access Denied', 'Only the bot admin can use this command.', 0xff4444)], ephemeral: true });
  }

  const userData = getUser(user.id);

  if (commandName === 'balance') {
    return interaction.reply({ embeds: [embed('💰 Balance', `**${user.username}** has **${userData.balance.toLocaleString()}** coins`, 0xf0c040)] });
  }

  if (commandName === 'daily') {
    const now = Date.now();
    const lastDaily = userData.lastDaily ? new Date(userData.lastDaily).getTime() : 0;
    const cooldown = 24 * 60 * 60 * 1000;
    if (now - lastDaily < cooldown) {
      const remaining = cooldown - (now - lastDaily);
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      return interaction.reply({ embeds: [embed('⏰ Daily Already Claimed', `Come back in **${h}h ${m}m**`, 0xff8800)], ephemeral: true });
    }
    const reward = Math.floor(Math.random() * 5000) + 1;
    userData.balance += reward;
    userData.lastDaily = new Date().toISOString();
    setBalance(user.id, userData.balance);
    const db = loadDB(); db.users[user.id].lastDaily = userData.lastDaily; saveDB(db);
    return interaction.reply({ embeds: [embed('🎁 Daily Reward!', `You claimed **${reward.toLocaleString()}** coins!\nNew balance: **${userData.balance.toLocaleString()}** coins`, 0x44ff88)] });
  }

  if (commandName === 'slots') {
    const bet = interaction.options.getInteger('bet');
    if (bet > userData.balance) return interaction.reply({ embeds: [embed('❌ Insufficient Funds', `You only have **${userData.balance.toLocaleString()}** coins.`, 0xff4444)], ephemeral: true });
    const result = playSlots(bet);
    const net = result.winnings - bet;
    userData.balance += net;
    setBalance(user.id, userData.balance);
    const won = result.winnings > 0;
    return interaction.reply({ embeds: [embed('🎰 Slots', 
      `[ ${result.display} ]\n\n${won ? `**WIN! ${result.multiplier}x** → +${result.winnings.toLocaleString()} coins` : '**No match** → -' + bet.toLocaleString() + ' coins'}\nBalance: **${userData.balance.toLocaleString()}** coins`,
      won ? 0x44ff88 : 0xff4444)] });
  }

  if (commandName === 'blackjack') {
    const bet = interaction.options.getInteger('bet');
    if (bet > userData.balance) return interaction.reply({ embeds: [embed('❌ Insufficient Funds', `You only have **${userData.balance.toLocaleString()}** coins.`, 0xff4444)], ephemeral: true });
    const r = playBlackjack(bet);
    const net = r.winnings - bet;
    userData.balance += net;
    setBalance(user.id, userData.balance);
    return interaction.reply({ embeds: [embed('🃏 Blackjack',
      `**Your hand:** ${r.playerCards} (${r.playerVal})\n**Dealer hand:** ${r.dealerCards} (${r.dealerVal})\n\n${r.result}\n${net >= 0 ? '+' : ''}${net.toLocaleString()} coins\nBalance: **${userData.balance.toLocaleString()}** coins`,
      r.winnings > bet ? 0x44ff88 : r.winnings === bet ? 0xf0c040 : 0xff4444)] });
  }

  if (commandName === 'roulette') {
    const bet = interaction.options.getInteger('bet');
    const choice = interaction.options.getString('choice');
    if (bet > userData.balance) return interaction.reply({ embeds: [embed('❌ Insufficient Funds', `You only have **${userData.balance.toLocaleString()}** coins.`, 0xff4444)], ephemeral: true });
    const r = playRoulette(bet, choice);
    const net = r.winnings - bet;
    userData.balance += net;
    setBalance(user.id, userData.balance);
    return interaction.reply({ embeds: [embed('🎡 Roulette',
      `${r.emoji} **${r.num}** (${r.color})\nYou bet on **${choice}** → ${r.hit ? `**WIN!** +${r.winnings.toLocaleString()} coins` : `**LOSS** -${bet.toLocaleString()} coins`}\nBalance: **${userData.balance.toLocaleString()}** coins`,
      r.hit ? 0x44ff88 : 0xff4444)] });
  }

  if (commandName === 'coinflip') {
    const bet = interaction.options.getInteger('bet');
    const choice = interaction.options.getString('choice');
    if (!['heads','tails'].includes(choice.toLowerCase())) return interaction.reply({ embeds: [embed('❌ Invalid', 'Choose **heads** or **tails**.', 0xff4444)], ephemeral: true });
    if (bet > userData.balance) return interaction.reply({ embeds: [embed('❌ Insufficient Funds', `You only have **${userData.balance.toLocaleString()}** coins.`, 0xff4444)], ephemeral: true });
    const r = playCoinFlip(bet, choice);
    const net = r.winnings - bet;
    userData.balance += net;
    setBalance(user.id, userData.balance);
    return interaction.reply({ embeds: [embed('🪙 Coin Flip',
      `${r.emoji} **${r.result}**\nYou picked **${choice}** → ${r.win ? `**WIN!** +${r.winnings.toLocaleString()} coins` : `**LOSS** -${bet.toLocaleString()} coins`}\nBalance: **${userData.balance.toLocaleString()}** coins`,
      r.win ? 0x44ff88 : 0xff4444)] });
  }

  if (commandName === 'dice') {
    const bet = interaction.options.getInteger('bet');
    const guess = interaction.options.getInteger('guess');
    if (bet > userData.balance) return interaction.reply({ embeds: [embed('❌ Insufficient Funds', `You only have **${userData.balance.toLocaleString()}** coins.`, 0xff4444)], ephemeral: true });
    const r = playDice(bet, guess);
    const net = r.winnings - bet;
    userData.balance += net;
    setBalance(user.id, userData.balance);
    const dice = ['⚀','⚁','⚂','⚃','⚄','⚅'];
    return interaction.reply({ embeds: [embed('🎲 Dice Roll',
      `${dice[r.roll-1]} Rolled **${r.roll}** | You guessed **${guess}**\n${r.win ? `**WIN! 5x** → +${r.winnings.toLocaleString()} coins` : `**MISS** → -${bet.toLocaleString()} coins`}\nBalance: **${userData.balance.toLocaleString()}** coins`,
      r.win ? 0x44ff88 : 0xff4444)] });
  }

  if (commandName === 'leaderboard') {
    const db = loadDB();
    const sorted = Object.entries(db.users).sort((a, b) => b[1].balance - a[1].balance).slice(0, 10);
    const lines = await Promise.all(sorted.map(async ([uid, data], i) => {
      let name = uid;
      try { const u = await client.users.fetch(uid); name = u.username; } catch {}
      const medals = ['🥇','🥈','🥉'];
      return `${medals[i] || `**${i+1}.**`} ${name} — **${data.balance.toLocaleString()}** coins`;
    }));
    return interaction.reply({ embeds: [embed('🏆 Leaderboard', lines.join('\n'), 0xf0c040)] });
  }

  // Admin commands
  if (commandName === 'setbalance') {
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    getUser(target.id);
    setBalance(target.id, amount);
    return interaction.reply({ embeds: [embed('✅ Balance Set', `Set **${target.username}**'s balance to **${amount.toLocaleString()}** coins.`, 0x44ff88)] });
  }

  if (commandName === 'setstartingbalance') {
    const amount = interaction.options.getInteger('amount');
    const config = loadConfig();
    config.starting_balance = amount;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    return interaction.reply({ embeds: [embed('✅ Starting Balance Updated', `New users will start with **${amount.toLocaleString()}** coins.`, 0x44ff88)] });
  }

  if (commandName === 'givemoney') {
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    const targetData = getUser(target.id);
    const newBal = Math.max(0, targetData.balance + amount);
    setBalance(target.id, newBal);
    return interaction.reply({ embeds: [embed('✅ Done', `${amount >= 0 ? 'Gave' : 'Took'} **${Math.abs(amount).toLocaleString()}** coins ${amount >= 0 ? 'to' : 'from'} **${target.username}**.\nNew balance: **${newBal.toLocaleString()}** coins`, 0x44ff88)] });
  }
});

client.login(process.env.TOKEN);

require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const fs = require('fs');

const DB_FILE = './db.json';
const CONFIG_FILE = './config.json';

// ─── Database helpers ────────────────────────────────────────────────────────
function loadDB() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, pendingDuels: {} }));
  const db = JSON.parse(fs.readFileSync(DB_FILE));
  if (!db.pendingDuels) { db.pendingDuels = {}; saveDB(db); }
  return db;
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    const defaults = {
      starting_balance: 1000,
      admin_id: process.env.ADMIN_ID || '',
      loan_interest: 10,
      loan_duration_hours: 24,
      loan_penalty: 20,
      lend_interest: 10,
      lend_duration_hours: 48,
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE));
  const defaults = { loan_interest: 10, loan_duration_hours: 24, loan_penalty: 20, lend_interest: 10, lend_duration_hours: 48 };
  let changed = false;
  for (const [k, v] of Object.entries(defaults)) { if (cfg[k] === undefined) { cfg[k] = v; changed = true; } }
  if (changed) fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  return cfg;
}
function getUser(userId) {
  const db = loadDB();
  const config = loadConfig();
  if (!db.users[userId]) {
    db.users[userId] = {
      balance: config.starting_balance,
      lastDaily: null,
      loan: null,
      lentTo: {},
      loanLevel: 0,
      loanCooldownUntil: null,
      totalLost: 0,
      blacklisted: false,
      rigWin: 0,
      rigLose: 0,
    };
    saveDB(db);
  }
  const u = db.users[userId];
  if (!u.lentTo) u.lentTo = {};
  if (u.loan === undefined) u.loan = null;
  if (u.loanLevel === undefined) u.loanLevel = 0;
  if (u.loanCooldownUntil === undefined) u.loanCooldownUntil = null;
  if (u.totalLost === undefined) u.totalLost = 0;
  if (u.blacklisted === undefined) u.blacklisted = false;
  if (u.rigWin === undefined) u.rigWin = 0;
  if (u.rigLose === undefined) u.rigLose = 0;
  return u;
}
function saveUser(userId, data) {
  const db = loadDB();
  db.users[userId] = data;
  saveDB(db);
}
function setBalance(userId, amount) {
  const db = loadDB();
  if (!db.users[userId]) db.users[userId] = { balance: amount, lastDaily: null, loan: null, lentTo: {}, loanLevel: 0, loanCooldownUntil: null, totalLost: 0, blacklisted: false, rigWin: 0, rigLose: 0 };
  else db.users[userId].balance = amount;
  saveDB(db);
}

// ─── Rig helper ───────────────────────────────────────────────────────────────
// Returns 'win', 'lose', or null (random)
function getRigOutcome(userData) {
  if (userData.rigWin > 0) {
    userData.rigWin--;
    return 'win';
  }
  if (userData.rigLose > 0) {
    userData.rigLose--;
    return 'lose';
  }
  return null;
}

// ─── Games ───────────────────────────────────────────────────────────────────
function playSlots(bet, rig) {
  const symbols = ['🍒', '🍋', '🍊', '🍇', '💎', '7️⃣'];
  const weights =  [30,   25,   20,   15,   7,    3  ];
  function spin() {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < symbols.length; i++) { r -= weights[i]; if (r <= 0) return symbols[i]; }
    return symbols[0];
  }
  let reels;
  if (rig === 'win') {
    const s = symbols[Math.floor(Math.random() * 4)]; // common symbol triple
    reels = [s, s, s];
  } else if (rig === 'lose') {
    do { reels = [spin(), spin(), spin()]; } while (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]);
  } else {
    reels = [spin(), spin(), spin()];
  }
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

function playBlackjack(bet, rig) {
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
  while (handVal(dealerHand) < 17) dealerHand.push(deck.pop());
  let pv = handVal(playerHand);
  let dv = handVal(dealerHand);

  // Force outcome if rigged
  if (rig === 'win') { dv = 22; } // dealer busts
  if (rig === 'lose') { pv = 22; } // player busts display-only

  let result, winnings;
  if (pv === 21 && playerHand.length === 2) { result = '🎉 Blackjack!'; winnings = Math.floor(bet * 2.5); }
  else if (pv > 21) { result = '💥 Bust!'; winnings = 0; }
  else if (dv > 21 || pv > dv) { result = '✅ You win!'; winnings = bet * 2; }
  else if (pv === dv) { result = '🤝 Push!'; winnings = bet; }
  else { result = '❌ Dealer wins!'; winnings = 0; }
  return { playerCards: fmt(playerHand), playerVal: pv > 21 ? 'Bust' : pv, dealerCards: fmt(dealerHand), dealerVal: dv > 21 ? 'Bust' : dv, result, winnings };
}

function playRoulette(bet, choice, rig) {
  const reds = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
  let num;
  if (rig === 'win') {
    const c = choice.toLowerCase();
    if (c === 'red') num = reds[Math.floor(Math.random() * reds.length)];
    else if (c === 'black') { const blacks = Array.from({length:36},(_,i)=>i+1).filter(n=>!reds.includes(n)); num = blacks[Math.floor(Math.random()*blacks.length)]; }
    else if (c === 'green') num = 0;
    else if (c === 'odd') { const odds = Array.from({length:36},(_,i)=>i+1).filter(n=>n%2!==0); num = odds[Math.floor(Math.random()*odds.length)]; }
    else if (c === 'even') { const evens = Array.from({length:36},(_,i)=>i+1).filter(n=>n%2===0); num = evens[Math.floor(Math.random()*evens.length)]; }
    else if (!isNaN(parseInt(c))) num = parseInt(c);
    else num = Math.floor(Math.random() * 37);
  } else if (rig === 'lose') {
    const c = choice.toLowerCase();
    let attempts = 0;
    do { num = Math.floor(Math.random() * 37); attempts++; } while (attempts < 100 && (
      (c === 'red' && reds.includes(num)) ||
      (c === 'black' && !reds.includes(num) && num !== 0) ||
      (c === 'green' && num === 0) ||
      (c === 'odd' && num !== 0 && num % 2 !== 0) ||
      (c === 'even' && num !== 0 && num % 2 === 0) ||
      (!isNaN(parseInt(c)) && parseInt(c) === num)
    ));
  } else {
    num = Math.floor(Math.random() * 37);
  }
  const isRed = reds.includes(num);
  const color = num === 0 ? 'green' : (isRed ? 'red' : 'black');
  let winnings = 0; let hit = false;
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

function playCoinFlip(bet, choice, rig) {
  let result;
  if (rig === 'win') result = choice.toLowerCase();
  else if (rig === 'lose') result = choice.toLowerCase() === 'heads' ? 'tails' : 'heads';
  else result = Math.random() < 0.5 ? 'heads' : 'tails';
  const win = choice.toLowerCase() === result;
  return { result, win, winnings: win ? bet * 2 : 0, emoji: result === 'heads' ? '🪙' : '🟤' };
}

function playDice(bet, guess, rig) {
  let roll;
  if (rig === 'win') roll = guess;
  else if (rig === 'lose') { do { roll = Math.floor(Math.random() * 6) + 1; } while (roll === guess); }
  else roll = Math.floor(Math.random() * 6) + 1;
  const win = guess === roll;
  return { roll, win, winnings: win ? bet * 5 : 0 };
}

// ─── Commands ─────────────────────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder().setName('balance').setDescription('Check your balance'),
  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily coins (1-5000)'),
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
  new SlashCommandBuilder().setName('leaderboard').setDescription('Show the top 10 richest users'),
  new SlashCommandBuilder().setName('toploser').setDescription('Show the top 10 biggest losers'),
  new SlashCommandBuilder().setName('pay')
    .setDescription('Send coins to another user')
    .addUserOption(o => o.setName('user').setDescription('Who to pay').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount to send').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('duel')
    .setDescription('Challenge someone to a coin flip duel')
    .addUserOption(o => o.setName('user').setDescription('Who to duel').setRequired(true))
    .addIntegerOption(o => o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('accept').setDescription('Accept a pending duel'),
  new SlashCommandBuilder().setName('decline').setDescription('Decline a pending duel'),
  new SlashCommandBuilder().setName('loan')
    .setDescription('Borrow coins from the bot')
    .addSubcommand(s => s.setName('take').setDescription('Take a loan from the bot')
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to borrow').setRequired(true).setMinValue(1)))
    .addSubcommand(s => s.setName('repay').setDescription('Repay your bot loan')
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to repay').setRequired(true).setMinValue(1)))
    .addSubcommand(s => s.setName('status').setDescription('Check your current loan')),
  new SlashCommandBuilder().setName('lend')
    .setDescription('Lend coins to another user')
    .addSubcommand(s => s.setName('give').setDescription('Lend coins to a user')
      .addUserOption(o => o.setName('user').setDescription('Who to lend to').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to lend').setRequired(true).setMinValue(1)))
    .addSubcommand(s => s.setName('collect').setDescription('Collect repayment from a borrower')
      .addUserOption(o => o.setName('user').setDescription('Who to collect from').setRequired(true)))
    .addSubcommand(s => s.setName('status').setDescription('See who owes you money')),
  // Admin commands
  new SlashCommandBuilder().setName('setbalance')
    .setDescription('[ADMIN] Set a users balance')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('New balance').setRequired(true).setMinValue(0)),
  new SlashCommandBuilder().setName('setstartingbalance')
    .setDescription('[ADMIN] Set the default starting balance for new users')
    .addIntegerOption(o => o.setName('amount').setDescription('Starting balance').setRequired(true).setMinValue(0)),
  new SlashCommandBuilder().setName('givemoney')
    .setDescription('[ADMIN] Give or take money from a user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount (negative to take)').setRequired(true)),
  new SlashCommandBuilder().setName('loanconfig')
    .setDescription('[ADMIN] Configure loan settings')
    .addStringOption(o => o.setName('setting').setDescription('Which setting to change').setRequired(true)
      .addChoices(
        { name: 'Bot loan interest %', value: 'loan_interest' },
        { name: 'Bot loan duration (hours)', value: 'loan_duration_hours' },
        { name: 'Bot loan penalty %', value: 'loan_penalty' },
        { name: 'Player lend interest %', value: 'lend_interest' },
        { name: 'Player lend duration (hours)', value: 'lend_duration_hours' },
      ))
    .addIntegerOption(o => o.setName('value').setDescription('New value').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('loansettings').setDescription('[ADMIN] View current loan settings'),
  new SlashCommandBuilder().setName('blacklist')
    .setDescription('[ADMIN] Blacklist or unblacklist a user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('action').setDescription('add or remove').setRequired(true)
      .addChoices({ name: 'Add to blacklist', value: 'add' }, { name: 'Remove from blacklist', value: 'remove' })),
  new SlashCommandBuilder().setName('rig')
    .setDescription('[ADMIN] Secretly rig a users next games')
    .addUserOption(o => o.setName('user').setDescription('User to rig').setRequired(true))
    .addStringOption(o => o.setName('outcome').setDescription('win or lose').setRequired(true)
      .addChoices({ name: 'Win', value: 'win' }, { name: 'Lose', value: 'lose' }))
    .addIntegerOption(o => o.setName('games').setDescription('How many games to rig').setRequired(true).setMinValue(1).setMaxValue(50)),
].map(c => c.toJSON());

// ─── Bot setup ────────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log('Logged in as ' + client.user.tag);
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID), { body: commands });
    console.log('Slash commands registered to guild');
  } catch (e) { console.error(e); }
});

function isAdmin(userId) { return userId === loadConfig().admin_id; }

function embed(title, description, color = 0x2b2d31) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
}

function formatTime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h + 'h ' + m + 'm';
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, user } = interaction;

  const adminCmds = ['setbalance', 'setstartingbalance', 'givemoney', 'loanconfig', 'loansettings', 'blacklist', 'rig'];
  if (adminCmds.includes(commandName) && !isAdmin(user.id)) {
    return interaction.reply({ embeds: [embed('❌ Access Denied', 'Only the bot admin can use this command.', 0xff4444)], ephemeral: true });
  }

  const userData = getUser(user.id);

  // Blacklist check (skip admin commands)
  if (!adminCmds.includes(commandName) && userData.blacklisted) {
    return interaction.reply({ embeds: [embed('🚫 Blacklisted', 'You have been banned from using this bot.', 0xff4444)], ephemeral: true });
  }

  if (commandName === 'balance') {
    return interaction.reply({ embeds: [embed('💰 Balance', '**' + user.username + '** has **' + userData.balance.toLocaleString() + '** coins', 0xf0c040)] });
  }

  if (commandName === 'daily') {
    const now = Date.now();
    const lastDaily = userData.lastDaily ? new Date(userData.lastDaily).getTime() : 0;
    const cooldown = 24 * 60 * 60 * 1000;
    if (now - lastDaily < cooldown) {
      const remaining = cooldown - (now - lastDaily);
      return interaction.reply({ embeds: [embed('⏰ Daily Already Claimed', 'Come back in **' + formatTime(remaining) + '**', 0xff8800)], ephemeral: true });
    }
    const reward = Math.floor(Math.random() * 5000) + 1;
    userData.balance += reward;
    userData.lastDaily = new Date().toISOString();
    saveUser(user.id, userData);
    return interaction.reply({ embeds: [embed('🎁 Daily Reward!', 'You claimed **' + reward.toLocaleString() + '** coins!\nNew balance: **' + userData.balance.toLocaleString() + '** coins', 0x44ff88)] });
  }

  if (commandName === 'slots') {
    const bet = interaction.options.getInteger('bet');
    if (bet > userData.balance) return interaction.reply({ embeds: [embed('❌ Insufficient Funds', 'You only have **' + userData.balance.toLocaleString() + '** coins.', 0xff4444)], ephemeral: true });
    const rig = getRigOutcome(userData);
    const result = playSlots(bet, rig);
    const net = result.winnings - bet;
    userData.balance += net;
    if (net < 0) userData.totalLost += Math.abs(net);
    saveUser(user.id, userData);
    const won = result.winnings > 0;
    return interaction.reply({ embeds: [embed('🎰 Slots',
      '[ ' + result.display + ' ]\n\n' + (won ? '**WIN! ' + result.multiplier + 'x** → +' + result.winnings.toLocaleString() + ' coins' : '**No match** → -' + bet.toLocaleString() + ' coins') + '\nBalance: **' + userData.balance.toLocaleString() + '** coins',
      won ? 0x44ff88 : 0xff4444)] });
  }

  if (commandName === 'blackjack') {
    const bet = interaction.options.getInteger('bet');
    if (bet > userData.balance) return interaction.reply({ embeds: [embed('❌ Insufficient Funds', 'You only have **' + userData.balance.toLocaleString() + '** coins.', 0xff4444)], ephemeral: true });
    const rig = getRigOutcome(userData);
    const r = playBlackjack(bet, rig);
    const net = r.winnings - bet;
    userData.balance += net;
    if (net < 0) userData.totalLost += Math.abs(net);
    saveUser(user.id, userData);
    return interaction.reply({ embeds: [embed('🃏 Blackjack',
      '**Your hand:** ' + r.playerCards + ' (' + r.playerVal + ')\n**Dealer hand:** ' + r.dealerCards + ' (' + r.dealerVal + ')\n\n' + r.result + '\n' + (net >= 0 ? '+' : '') + net.toLocaleString() + ' coins\nBalance: **' + userData.balance.toLocaleString() + '** coins',
      r.winnings > bet ? 0x44ff88 : r.winnings === bet ? 0xf0c040 : 0xff4444)] });
  }

  if (commandName === 'roulette') {
    const bet = interaction.options.getInteger('bet');
    const choice = interaction.options.getString('choice');
    if (bet > userData.balance) return interaction.reply({ embeds: [embed('❌ Insufficient Funds', 'You only have **' + userData.balance.toLocaleString() + '** coins.', 0xff4444)], ephemeral: true });
    const rig = getRigOutcome(userData);
    const r = playRoulette(bet, choice, rig);
    const net = r.winnings - bet;
    userData.balance += net;
    if (net < 0) userData.totalLost += Math.abs(net);
    saveUser(user.id, userData);
    return interaction.reply({ embeds: [embed('🎡 Roulette',
      r.emoji + ' **' + r.num + '** (' + r.color + ')\nYou bet on **' + choice + '** → ' + (r.hit ? '**WIN!** +' + r.winnings.toLocaleString() + ' coins' : '**LOSS** -' + bet.toLocaleString() + ' coins') + '\nBalance: **' + userData.balance.toLocaleString() + '** coins',
      r.hit ? 0x44ff88 : 0xff4444)] });
  }

  if (commandName === 'coinflip') {
    const bet = interaction.options.getInteger('bet');
    const choice = interaction.options.getString('choice');
    if (!['heads','tails'].includes(choice.toLowerCase())) return interaction.reply({ embeds: [embed('❌ Invalid', 'Choose **heads** or **tails**.', 0xff4444)], ephemeral: true });
    if (bet > userData.balance) return interaction.reply({ embeds: [embed('❌ Insufficient Funds', 'You only have **' + userData.balance.toLocaleString() + '** coins.', 0xff4444)], ephemeral: true });
    const rig = getRigOutcome(userData);
    const r = playCoinFlip(bet, choice, rig);
    const net = r.winnings - bet;
    userData.balance += net;
    if (net < 0) userData.totalLost += Math.abs(net);
    saveUser(user.id, userData);
    return interaction.reply({ embeds: [embed('🪙 Coin Flip',
      r.emoji + ' **' + r.result + '**\nYou picked **' + choice + '** → ' + (r.win ? '**WIN!** +' + r.winnings.toLocaleString() + ' coins' : '**LOSS** -' + bet.toLocaleString() + ' coins') + '\nBalance: **' + userData.balance.toLocaleString() + '** coins',
      r.win ? 0x44ff88 : 0xff4444)] });
  }

  if (commandName === 'dice') {
    const bet = interaction.options.getInteger('bet');
    const guess = interaction.options.getInteger('guess');
    if (bet > userData.balance) return interaction.reply({ embeds: [embed('❌ Insufficient Funds', 'You only have **' + userData.balance.toLocaleString() + '** coins.', 0xff4444)], ephemeral: true });
    const rig = getRigOutcome(userData);
    const r = playDice(bet, guess, rig);
    const net = r.winnings - bet;
    userData.balance += net;
    if (net < 0) userData.totalLost += Math.abs(net);
    saveUser(user.id, userData);
    const dice = ['⚀','⚁','⚂','⚃','⚄','⚅'];
    return interaction.reply({ embeds: [embed('🎲 Dice Roll',
      dice[r.roll-1] + ' Rolled **' + r.roll + '** | You guessed **' + guess + '**\n' + (r.win ? '**WIN! 5x** → +' + r.winnings.toLocaleString() + ' coins' : '**MISS** → -' + bet.toLocaleString() + ' coins') + '\nBalance: **' + userData.balance.toLocaleString() + '** coins',
      r.win ? 0x44ff88 : 0xff4444)] });
  }

  if (commandName === 'leaderboard') {
    const db = loadDB();
    const sorted = Object.entries(db.users).sort((a, b) => b[1].balance - a[1].balance).slice(0, 10);
    const lines = await Promise.all(sorted.map(async ([uid, data], i) => {
      let name = uid;
      try { const u = await client.users.fetch(uid); name = u.username; } catch {}
      const medals = ['🥇','🥈','🥉'];
      return (medals[i] || '**' + (i+1) + '.**') + ' ' + name + ' — **' + data.balance.toLocaleString() + '** coins';
    }));
    return interaction.reply({ embeds: [embed('🏆 Leaderboard', lines.join('\n'), 0xf0c040)] });
  }

  if (commandName === 'toploser') {
    const db = loadDB();
    const sorted = Object.entries(db.users).sort((a, b) => (b[1].totalLost || 0) - (a[1].totalLost || 0)).slice(0, 10);
    const lines = await Promise.all(sorted.map(async ([uid, data], i) => {
      let name = uid;
      try { const u = await client.users.fetch(uid); name = u.username; } catch {}
      return '**' + (i+1) + '.** ' + name + ' — lost **' + (data.totalLost || 0).toLocaleString() + '** coins';
    }));
    return interaction.reply({ embeds: [embed('📉 Top Losers', lines.join('\n'), 0xff4444)] });
  }

  if (commandName === 'pay') {
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    if (target.id === user.id) return interaction.reply({ embeds: [embed('❌ Invalid', "You can't pay yourself.", 0xff4444)], ephemeral: true });
    if (target.bot) return interaction.reply({ embeds: [embed('❌ Invalid', "You can't pay a bot.", 0xff4444)], ephemeral: true });
    if (amount > userData.balance) return interaction.reply({ embeds: [embed('❌ Insufficient Funds', 'You only have **' + userData.balance.toLocaleString() + '** coins.', 0xff4444)], ephemeral: true });
    const targetData = getUser(target.id);
    setBalance(user.id, userData.balance - amount);
    setBalance(target.id, targetData.balance + amount);
    return interaction.reply({ embeds: [embed('💸 Payment Sent', '**' + user.username + '** sent **' + amount.toLocaleString() + '** coins to **' + target.username + '**', 0x44ff88)] });
  }

  // ─── Duel ─────────────────────────────────────────────────────────────────
  if (commandName === 'duel') {
    const target = interaction.options.getUser('user');
    const bet = interaction.options.getInteger('bet');
    if (target.id === user.id) return interaction.reply({ embeds: [embed('❌ Invalid', "You can't duel yourself.", 0xff4444)], ephemeral: true });
    if (target.bot) return interaction.reply({ embeds: [embed('❌ Invalid', "You can't duel a bot.", 0xff4444)], ephemeral: true });
    if (bet > userData.balance) return interaction.reply({ embeds: [embed('❌ Insufficient Funds', 'You only have **' + userData.balance.toLocaleString() + '** coins.', 0xff4444)], ephemeral: true });
    const targetData = getUser(target.id);
    if (bet > targetData.balance) return interaction.reply({ embeds: [embed('❌ Insufficient Funds', '**' + target.username + "** doesn't have enough coins.", 0xff4444)], ephemeral: true });
    const db = loadDB();
    db.pendingDuels[target.id] = { challengerId: user.id, challengerName: user.username, bet, expiresAt: Date.now() + 60000 };
    saveDB(db);
    return interaction.reply({ embeds: [embed('⚔️ Duel Challenged!',
      '**' + user.username + '** challenged **' + target.username + '** to a duel for **' + bet.toLocaleString() + '** coins!\n' + target.username + ', use **/accept** or **/decline** within 60 seconds.',
      0x5865f2)] });
  }

  if (commandName === 'accept') {
    const db = loadDB();
    const duel = db.pendingDuels[user.id];
    if (!duel) return interaction.reply({ embeds: [embed('❌ No Duel', "You don't have a pending duel.", 0xff4444)], ephemeral: true });
    if (Date.now() > duel.expiresAt) {
      delete db.pendingDuels[user.id];
      saveDB(db);
      return interaction.reply({ embeds: [embed('⏰ Expired', 'That duel request has expired.', 0xff8800)], ephemeral: true });
    }
    const challengerData = getUser(duel.challengerId);
    const accepterData = getUser(user.id);
    if (duel.bet > challengerData.balance) {
      delete db.pendingDuels[user.id];
      saveDB(db);
      return interaction.reply({ embeds: [embed('❌ Insufficient Funds', 'The challenger no longer has enough coins.', 0xff4444)] });
    }
    if (duel.bet > accepterData.balance) return interaction.reply({ embeds: [embed('❌ Insufficient Funds', 'You no longer have enough coins.', 0xff4444)], ephemeral: true });
    const challengerWins = Math.random() < 0.5;
    if (challengerWins) {
      challengerData.balance += duel.bet;
      accepterData.balance -= duel.bet;
      accepterData.totalLost += duel.bet;
    } else {
      accepterData.balance += duel.bet;
      challengerData.balance -= duel.bet;
      challengerData.totalLost += duel.bet;
    }
    saveUser(duel.challengerId, challengerData);
    saveUser(user.id, accepterData);
    delete db.pendingDuels[user.id];
    saveDB(db);
    const winner = challengerWins ? duel.challengerName : user.username;
    const loser = challengerWins ? user.username : duel.challengerName;
    return interaction.reply({ embeds: [embed('⚔️ Duel Result!',
      '🏆 **' + winner + '** wins **' + duel.bet.toLocaleString() + '** coins from **' + loser + '**!',
      0x44ff88)] });
  }

  if (commandName === 'decline') {
    const db = loadDB();
    const duel = db.pendingDuels[user.id];
    if (!duel) return interaction.reply({ embeds: [embed('❌ No Duel', "You don't have a pending duel.", 0xff4444)], ephemeral: true });
    delete db.pendingDuels[user.id];
    saveDB(db);
    return interaction.reply({ embeds: [embed('❌ Duel Declined', '**' + user.username + '** declined the duel.', 0xff8800)] });
  }

  // ─── Loan (bot loans) ────────────────────────────────────────────────────
  if (commandName === 'loan') {
    const sub = interaction.options.getSubcommand();
    const config = loadConfig();
    const now = Date.now();

    if (userData.loan && now > userData.loan.dueAt && !userData.loan.penaltyApplied) {
      const penalty = Math.floor(userData.balance * (config.loan_penalty / 100));
      userData.balance = Math.max(0, userData.balance - penalty);
      userData.loan.penaltyApplied = true;
      saveUser(user.id, userData);
    }

    if (sub === 'take') {
      if (userData.loan) return interaction.reply({ embeds: [embed('❌ Existing Loan', 'You already have a loan of **' + userData.loan.owed.toLocaleString() + '** coins. Repay it first.', 0xff4444)], ephemeral: true });
      if (userData.loanCooldownUntil && now < userData.loanCooldownUntil) {
        const remaining = userData.loanCooldownUntil - now;
        return interaction.reply({ embeds: [embed('⏰ Loan Cooldown', 'You must wait **' + formatTime(remaining) + '** before taking another loan.', 0xff8800)], ephemeral: true });
      }
      const maxLoan = (userData.loanLevel + 1) * 1000;
      const amount = interaction.options.getInteger('amount');
      if (amount > maxLoan) return interaction.reply({ embeds: [embed('❌ Loan Too Large', 'Your current loan limit is **' + maxLoan.toLocaleString() + '** coins. Pay off more loans to increase your limit.', 0xff4444)], ephemeral: true });
      const interest = Math.floor(amount * (config.loan_interest / 100));
      const owed = amount + interest;
      const dueAt = now + config.loan_duration_hours * 3600000;
      userData.balance += amount;
      userData.loan = { original: amount, owed, dueAt, takenAt: now, penaltyApplied: false };
      saveUser(user.id, userData);
      return interaction.reply({ embeds: [embed('🏦 Loan Approved',
        'You borrowed **' + amount.toLocaleString() + '** coins.\nYou owe **' + owed.toLocaleString() + '** coins (' + config.loan_interest + '% interest).\nDue in **' + config.loan_duration_hours + 'h**.\nYour loan limit: **' + maxLoan.toLocaleString() + '** coins\n\nBalance: **' + userData.balance.toLocaleString() + '** coins',
        0x44ff88)] });
    }

    if (sub === 'repay') {
      if (!userData.loan) return interaction.reply({ embeds: [embed('❌ No Loan', "You don't have an active loan.", 0xff4444)], ephemeral: true });
      const amount = interaction.options.getInteger('amount');
      if (amount > userData.balance) return interaction.reply({ embeds: [embed('❌ Insufficient Funds', 'You only have **' + userData.balance.toLocaleString() + '** coins.', 0xff4444)], ephemeral: true });
      const paying = Math.min(amount, userData.loan.owed);
      userData.balance -= paying;
      userData.loan.owed -= paying;
      let msg = 'Paid **' + paying.toLocaleString() + '** coins.\n';
      if (userData.loan.owed <= 0) {
        userData.loan = null;
        userData.loanLevel += 1;
        userData.loanCooldownUntil = Date.now() + 1.5 * 3600000;
        const newMax = (userData.loanLevel + 1) * 1000;
        msg += '✅ Loan fully repaid! Your loan limit is now **' + newMax.toLocaleString() + '** coins.\nNext loan available in **1h 30m**.';
      } else {
        msg += 'Still owe **' + userData.loan.owed.toLocaleString() + '** coins.';
      }
      msg += '\nBalance: **' + userData.balance.toLocaleString() + '** coins';
      saveUser(user.id, userData);
      return interaction.reply({ embeds: [embed('💳 Loan Repayment', msg, userData.loan ? 0xf0c040 : 0x44ff88)] });
    }

    if (sub === 'status') {
      const maxLoan = (userData.loanLevel + 1) * 1000;
      if (!userData.loan) {
        let msg = 'You have no active loan.\nLoan limit: **' + maxLoan.toLocaleString() + '** coins';
        if (userData.loanCooldownUntil && Date.now() < userData.loanCooldownUntil) {
          msg += '\nNext loan available in: **' + formatTime(userData.loanCooldownUntil - Date.now()) + '**';
        }
        return interaction.reply({ embeds: [embed('🏦 Loan Status', msg, 0x44ff88)] });
      }
      const timeLeft = userData.loan.dueAt - Date.now();
      const overdue = timeLeft < 0;
      return interaction.reply({ embeds: [embed('🏦 Loan Status',
        'Owed: **' + userData.loan.owed.toLocaleString() + '** coins\n' + (overdue ? '⚠️ OVERDUE — penalty has been applied' : 'Due in: **' + formatTime(timeLeft) + '**') + '\nLoan limit: **' + maxLoan.toLocaleString() + '** coins',
        overdue ? 0xff4444 : 0xf0c040)] });
    }
  }

  // ─── Lend (player loans) ─────────────────────────────────────────────────
  if (commandName === 'lend') {
    const sub = interaction.options.getSubcommand();
    const config = loadConfig();
    const now = Date.now();

    if (sub === 'give') {
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      if (target.id === user.id) return interaction.reply({ embeds: [embed('❌ Invalid', "You can't lend to yourself.", 0xff4444)], ephemeral: true });
      if (target.bot) return interaction.reply({ embeds: [embed('❌ Invalid', "You can't lend to a bot.", 0xff4444)], ephemeral: true });
      if (amount > userData.balance) return interaction.reply({ embeds: [embed('❌ Insufficient Funds', 'You only have **' + userData.balance.toLocaleString() + '** coins.', 0xff4444)], ephemeral: true });
      if (userData.lentTo[target.id]) return interaction.reply({ embeds: [embed('❌ Already Lent', 'You already have an active loan with **' + target.username + '**. Collect it first.', 0xff4444)], ephemeral: true });
      const targetData = getUser(target.id);
      const interest = Math.floor(amount * (config.lend_interest / 100));
      const owed = amount + interest;
      const dueAt = now + config.lend_duration_hours * 3600000;
      userData.balance -= amount;
      userData.lentTo[target.id] = { amount, owed, dueAt, lentAt: now };
      targetData.balance += amount;
      saveUser(user.id, userData);
      saveUser(target.id, targetData);
      return interaction.reply({ embeds: [embed('🤝 Loan Given',
        'You lent **' + amount.toLocaleString() + '** coins to **' + target.username + '**.\nThey owe you **' + owed.toLocaleString() + '** coins (' + config.lend_interest + '% interest) due in **' + config.lend_duration_hours + 'h**.',
        0x44ff88)] });
    }

    if (sub === 'collect') {
      const target = interaction.options.getUser('user');
      const loanEntry = userData.lentTo[target.id];
      if (!loanEntry) return interaction.reply({ embeds: [embed('❌ No Loan', "You don't have an active loan with **" + target.username + "**.", 0xff4444)], ephemeral: true });
      const overdue = now > loanEntry.dueAt;
      const targetData = getUser(target.id);
      if (!overdue && targetData.balance < loanEntry.owed) {
        return interaction.reply({ embeds: [embed('⏳ Not Collectible Yet', '**' + target.username + "** doesn't have enough coins yet and the loan isn't overdue.", 0xff8800)], ephemeral: true });
      }
      const collect = Math.min(targetData.balance, loanEntry.owed);
      targetData.balance -= collect;
      userData.balance += collect;
      delete userData.lentTo[target.id];
      saveUser(user.id, userData);
      saveUser(target.id, targetData);
      const short = loanEntry.owed - collect;
      return interaction.reply({ embeds: [embed('💰 Collected',
        'Collected **' + collect.toLocaleString() + '** coins from **' + target.username + '**.\n' + (short > 0 ? '⚠️ They were short **' + short.toLocaleString() + '** coins.' : '✅ Fully repaid!') + '\nYour balance: **' + userData.balance.toLocaleString() + '** coins',
        short > 0 ? 0xff8800 : 0x44ff88)] });
    }

    if (sub === 'status') {
      const entries = Object.entries(userData.lentTo);
      if (entries.length === 0) return interaction.reply({ embeds: [embed('🤝 Lending Status', "You haven't lent money to anyone.", 0x44ff88)] });
      const lines = await Promise.all(entries.map(async ([uid, data]) => {
        let name = uid;
        try { const u = await client.users.fetch(uid); name = u.username; } catch {}
        const overdue = now > data.dueAt;
        return '**' + name + '** — owes **' + data.owed.toLocaleString() + '** coins ' + (overdue ? '⚠️ OVERDUE' : '(due in ' + formatTime(data.dueAt - now) + ')');
      }));
      return interaction.reply({ embeds: [embed('🤝 Lending Status', lines.join('\n'), 0xf0c040)] });
    }
  }

  // ─── Admin commands ──────────────────────────────────────────────────────
  if (commandName === 'setbalance') {
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    getUser(target.id);
    setBalance(target.id, amount);
    return interaction.reply({ embeds: [embed('✅ Balance Set', 'Set **' + target.username + "**'s balance to **" + amount.toLocaleString() + '** coins.', 0x44ff88)], ephemeral: true });
  }

  if (commandName === 'setstartingbalance') {
    const amount = interaction.options.getInteger('amount');
    const config = loadConfig();
    config.starting_balance = amount;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    return interaction.reply({ embeds: [embed('✅ Starting Balance Updated', 'New users will start with **' + amount.toLocaleString() + '** coins.', 0x44ff88)], ephemeral: true });
  }

  if (commandName === 'givemoney') {
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    const targetData = getUser(target.id);
    const newBal = Math.max(0, targetData.balance + amount);
    setBalance(target.id, newBal);
    return interaction.reply({ embeds: [embed('✅ Done', (amount >= 0 ? 'Gave' : 'Took') + ' **' + Math.abs(amount).toLocaleString() + '** coins ' + (amount >= 0 ? 'to' : 'from') + ' **' + target.username + '**.\nNew balance: **' + newBal.toLocaleString() + '** coins', 0x44ff88)], ephemeral: true });
  }

  if (commandName === 'loanconfig') {
    const setting = interaction.options.getString('setting');
    const value = interaction.options.getInteger('value');
    const config = loadConfig();
    config[setting] = value;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    const labels = { loan_interest: 'Bot loan interest', loan_duration_hours: 'Bot loan duration', loan_penalty: 'Bot loan penalty', lend_interest: 'Player lend interest', lend_duration_hours: 'Player lend duration' };
    return interaction.reply({ embeds: [embed('✅ Loan Config Updated', '**' + labels[setting] + '** set to **' + value + (setting.includes('hours') ? 'h' : '%') + '**', 0x44ff88)], ephemeral: true });
  }

  if (commandName === 'loansettings') {
    const config = loadConfig();
    return interaction.reply({ embeds: [embed('⚙️ Loan Settings',
      '**Bot Loan Interest:** ' + config.loan_interest + '%\n**Bot Loan Duration:** ' + config.loan_duration_hours + 'h\n**Bot Loan Penalty:** ' + config.loan_penalty + '%\n\n**Player Lend Interest:** ' + config.lend_interest + '%\n**Player Lend Duration:** ' + config.lend_duration_hours + 'h',
      0x5865f2)], ephemeral: true });
  }

  if (commandName === 'blacklist') {
    const target = interaction.options.getUser('user');
    const action = interaction.options.getString('action');
    const targetData = getUser(target.id);
    targetData.blacklisted = action === 'add';
    saveUser(target.id, targetData);
    return interaction.reply({ embeds: [embed('✅ Blacklist Updated', '**' + target.username + '** has been ' + (action === 'add' ? 'blacklisted 🚫' : 'removed from the blacklist ✅') + '.', 0x44ff88)], ephemeral: true });
  }

  if (commandName === 'rig') {
    const target = interaction.options.getUser('user');
    const outcome = interaction.options.getString('outcome');
    const games = interaction.options.getInteger('games');
    const targetData = getUser(target.id);
    if (outcome === 'win') { targetData.rigWin += games; targetData.rigLose = 0; }
    else { targetData.rigLose += games; targetData.rigWin = 0; }
    saveUser(target.id, targetData);
    return interaction.reply({ embeds: [embed('🎲 Rigged', "**" + target.username + "**'s next **" + games + "** games will **" + outcome + "**.", 0x5865f2)], ephemeral: true });
  }
});

client.login(process.env.TOKEN);

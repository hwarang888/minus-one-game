// server.js (Express + Socket.IO, with explicit phase/round logic)

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: "http://localhost:5173"
}));

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

const rooms = {}; // roomId -> { players, phase, roundNumber, ... }

server.listen(8080, () => {
  console.log("Server listening on http://localhost:8080");
});

io.on("connection", (socket) => {
  socket.on('join-room', ({ roomId, playerName }) => {
    if (!roomId) return;
    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        phase: 0, // Lobby
        roundNumber: 0,
        timer: 0,
        timerInterval: null
      };
    }
    const room = rooms[roomId];

    // Prevent duplicate join
    if (room.players.some(p => p.id === socket.id)) return;

    const player = {
      id: socket.id,
      name: playerName,
      cards: [],
      playedCards: [],
      used: [], // Explicitly initialize used array
      points: 0,
      isHost: room.players.length === 0,
      shown: [], // for phase 1
      final: null, // for phase 2
      justShownNotFinal: [], // for future: manage "can't use next round" logic
      bannedThisRound: [],
      bannedNextRound: []
    };
    room.players.push(player);
    socket.join(roomId);
    socket.roomId = roomId;

    // Let player know they joined and if they are host
    socket.emit('joined-room', {
      room: roomId,
      id: player.id,
      players: room.players.map(({ id, name, points }) => ({ id, name, points })),
      isHost: player.isHost
    });
    broadcastRoom(roomId);
  });

  socket.on('start-game', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    if (room.phase !== 0 || room.players.length < 2) return;

    room.phase = 1; // Phase 1: pick 2 cards
    room.roundNumber = 1;
    room.timer = 30;

    room.players.forEach((player) => {
      player.cards = [1,2,3,4,5,6,7,8];
      player.playedCards = [];
      player.used = []; // Initialize used array
      player.points = 0;
      player.shown = [];
      player.final = null;
      player.justShownNotFinal = [];
      player.bannedThisRound = [];
      player.bannedNextRound = [];
    });

    startTimer(roomId);
    broadcastRoom(roomId);
  });

  socket.on('select-card', ({ card }) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    if (room.phase !== 1) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    if (
      player.shown.length < 2 &&
      player.cards.includes(card) &&
      !player.shown.includes(card) &&
      (!player.bannedThisRound || !player.bannedThisRound.includes(card))
    ) {
      player.shown.push(card);
      broadcastRoom(roomId);

      if (room.players.every(p => p.shown.length === 2)) {
        // All ready before timer up: auto-select for any remaining players and move on
        autoSelectForPhase1(roomId); // This will handle any edge cases
        setTimeout(() => endPhase1(roomId), 1000);
      }
    }
  });

  socket.on('select-final', ({ card }) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    if (room.phase !== 2) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    if (player.shown.includes(card)) {
      player.final = card;
      broadcastRoom(roomId);

      if (room.players.every(p => p.final !== null)) {
        // All ready before timer up: auto-select for any remaining players and resolve
        autoSelectForPhase2(roomId); // This will handle any edge cases
        setTimeout(() => endPhase2(roomId), 1000);
      }
    }
  });

  socket.on("disconnect", () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    let room = rooms[roomId];
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) {
      delete rooms[roomId];
      console.log(`Room ${roomId} deleted (no players remaining)`);
    } else {
      broadcastRoom(roomId);
    }
  });
});

// Phase 1 timer (pick 2)
function startTimer(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.timerInterval) clearInterval(room.timerInterval);
  room.timerInterval = setInterval(() => {
    room.timer--;
    broadcastRoom(roomId);
    if (room.timer <= 0) {
      clearInterval(room.timerInterval);
      room.timerInterval = null;
      if (room.phase === 1) {
        autoSelectForPhase1(roomId); // Auto-select before ending phase 1
        endPhase1(roomId);
      } else if (room.phase === 2) {
        autoSelectForPhase2(roomId); // Auto-select before ending phase 2
        endPhase2(roomId);
      }
    }
  }, 1000);
}

// Fixed function: Auto-select lowest 2 cards for players who didn't pick
function autoSelectForPhase1(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  
  room.players.forEach(player => {
    if (player.shown.length < 2) {
      // Get available cards (not used, not banned) - with null checks
      const availableCards = player.cards.filter(card => 
        !(player.used || []).includes(card) && // Add null check for used
        !player.shown.includes(card) &&
        !(player.bannedThisRound || []).includes(card) // Add null check for bannedThisRound
      );
      
      // Sort and take the lowest cards needed
      const neededCards = 2 - player.shown.length;
      const lowestCards = availableCards.sort((a, b) => a - b).slice(0, neededCards);
      
      // Add them to shown
      player.shown.push(...lowestCards);
      
      console.log(`Auto-selected cards ${lowestCards.join(', ')} for player ${player.name}`);
    }
  });
  
  // Broadcast the update so clients see the auto-selections
  broadcastRoom(roomId);
}

// Fixed function: Auto-select lower card for players who didn't pick final
function autoSelectForPhase2(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  
  room.players.forEach(player => {
    if ((player.final === null || player.final === undefined) && player.shown && player.shown.length > 0) {
      // Pick the lowest from the shown cards
      const lowestShown = Math.min(...player.shown);
      player.final = lowestShown;
      
      console.log(`Auto-selected final card ${lowestShown} for player ${player.name}`);
    }
  });
  
  // Broadcast the update so clients see the auto-selections
  broadcastRoom(roomId);
}

// Move from phase 1 to phase 2
function endPhase1(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  clearInterval(room.timerInterval);
  room.timerInterval = null;

  room.phase = 2; // Move to phase 2: pick final
  room.timer = 30;
  // Send update (reveal everyone's shown two cards!)
  broadcastRoom(roomId);
  startTimer(roomId);
}

// Updated endPhase2 function with card replenishment
function endPhase2(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  clearInterval(room.timerInterval);
  room.timerInterval = null;

  // Move to reveal phase first
  room.phase = 3; // New phase for revealing final cards
  room.timer = 5; // 5 seconds to show final selections
  broadcastRoom(roomId);

  // Start timer for reveal phase
  setTimeout(() => {
    if (!rooms[roomId]) return;
    
    resolveRound(roomId);

    // Add 20-second delay before next round
    setTimeout(() => {
      if (!rooms[roomId]) return;
      const winner = room.players.find(p => p.points >= 3);
      if (winner) {
        room.phase = 99;
        room.winner = winner.name;
        broadcastRoom(roomId, { winner: winner.name });
      } else {
        // Start next round
        room.phase = 1;
        room.roundNumber += 1;
        room.timer = 30;
        
        // Check if we need to replenish cards
        if (shouldReplenishCards(room.roundNumber)) {
          replenishAllCards(roomId);
        } else {
          // Normal round progression
          room.players.forEach(p => {
            p.shown = [];
            p.final = null;
            p.bannedThisRound = p.bannedNextRound || [];
            p.bannedNextRound = [];
          });
        }
        
        broadcastRoom(roomId);
        startTimer(roomId);
      }
    }, 20000);
  }, 5000); // 5 seconds reveal time
}


function broadcastRoom(roomId, extra = {}) {
  const room = rooms[roomId];
  if (!room) return;
  const state = {
    phase: room.phase,
    timer: room.timer,
    round: room.roundNumber,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      hand: p.cards,
      shown: p.shown,
      final: p.final,
      points: p.points,
      used: p.playedCards,
      banned: p.bannedThisRound || [], // ← Make sure this is included for ALL players
      isHost: p.isHost
    })),
    ...extra
  };
  io.in(roomId).emit('room-update', state);
}

// Game round resolution logic. After phase 2
function resolveRound(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  // Collect all finalised cards
  const finals = room.players.map(p => p.final);
  const counts = finals.reduce((acc, val) => {
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {});
  let lowest = Infinity;
  let winnerIndex = -1;
  room.players.forEach((p, i) => {
    const val = p.final;
    if (counts[val] === 1 && typeof val === 'number' && val < lowest) {
      lowest = val;
      winnerIndex = i;
    }
  });
  if (winnerIndex !== -1) {
    room.players[winnerIndex].points++;
  }

  // SET BAN LOGIC BEFORE clearing shown/final
  room.players.forEach(p => {
    if (Array.isArray(p.shown) && p.shown.length === 2 && p.final !== null) {
      const notFinal = p.shown.find(c => c !== p.final);
      if (typeof notFinal !== 'undefined') {
        p.bannedNextRound = [notFinal]; // ban only for next round
      } else {
        p.bannedNextRound = [];
      }
    } else {
      p.bannedNextRound = [];
    }
  });

  // NOW clear for next round
  room.players.forEach(p => {
    if (p.final !== null) {
      p.playedCards.push(p.final);
      p.cards = p.cards.filter(c => c !== p.final);
    }
    p.shown = [];
    p.final = null;
  });

  broadcastRoom(roomId, {
    result: winnerIndex !== -1 ? room.players[winnerIndex].name : 'No winner this round',
  });
}

// New function to check if cards should be replenished
function shouldReplenishCards(roundNumber) {
  return roundNumber % 6 === 1 && roundNumber > 1; // Rounds 7, 13, 19, etc.
}

// New function to replenish all players' cards
function replenishAllCards(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  
  console.log(`Replenishing cards for all players in room ${roomId} at round ${room.roundNumber}`);
  
  room.players.forEach(player => {
    player.cards = [1, 2, 3, 4, 5, 6, 7, 8]; // Reset to full deck
    player.playedCards = []; // Clear used cards history
    player.used = []; // Clear used array
    player.bannedThisRound = []; // Clear any bans (fresh start)
    player.bannedNextRound = []; // Clear next round bans
  });
  
  // Broadcast the replenishment to all players
  broadcastRoom(roomId, {
    message: `🎴 Cards replenished! All players now have cards 1-8 again.`,
    replenished: true
  });
}

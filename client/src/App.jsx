import React, { useEffect, useState } from "react";
import io from "socket.io-client";

const socket = io(process.env.REACT_APP_SERVER_URL || "http://localhost:8080");

export default function App() {
  const [playerId, setPlayerId] = useState(null);
  const [players, setPlayers] = useState([]);
  const [phase, setPhase] = useState(0); // 0: lobby, 1: pick 2, 2: pick final, 3: reveal, 99: ended
  const [room, setRoom] = useState("");
  const [timer, setTimer] = useState(0);
  const [round, setRound] = useState(0);
  const [error, setError] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [winner, setWinner] = useState("");
  const [result, setResult] = useState("");
  const [showingResult, setShowingResult] = useState(false);
  
  // Listen for socket.io events
  useEffect(() => {
    socket.on("joined-room", ({ room, id, players, isHost }) => {
      setRoom(room);
      setPlayerId(id);
      setPlayers(players);
      setIsHost(isHost);
      setError("");
    });
    socket.on("room-update", ({ phase, timer, players, round, winner, result, message, replenished }) => {
      setPhase(phase);
      setTimer(timer || 0);
      setPlayers(players);
      setRound(round || 1);
      setWinner(winner || "");

      if (result && result !== "") {
        setResult(result);
        setShowingResult(true);
        setTimeout(() => setShowingResult(false), 3000);
      }

      // Handle replenishment message
      if (message && replenished) {
        setResult(message);
        setShowingResult(true);
        setTimeout(() => setShowingResult(false), 4000); // Show longer for replenishment
      }

      setError("");
    });
    socket.on("error-msg", (msg) => {
      setError(msg);
    });
    return () => {
      socket.off("joined-room");
      socket.off("room-update");
      socket.off("error-msg");
    };
  }, []);

  // Helper: get current player object
  const self = players.find(p => p.id === playerId);

  // Join or create a room
  function joinRoom(e) {
    e.preventDefault();
    const room = e.target.room.value;
    const name = e.target.name.value;
    socket.emit("join-room", { roomId: room, playerName: name });
  }

  function selectCard(card) {
    socket.emit("select-card", { card });
  }

  function selectFinal(card) {
    socket.emit("select-final", { card });
  }

  // Enhanced Card component with banned card styling
  function Card({ 
    value, 
    isBack = false, 
    isHighlighted = false, 
    isSelected = false, 
    disabled = false, 
    isBanned = false,
    onClick,
    style = {} 
  }) {
    const cardStyle = {
      width: 40,
      height: 60,
      border: '2px solid',
      borderColor: isBanned ? '#ff5722' : 
                  isHighlighted ? '#ff6b35' : 
                  isSelected ? '#4CAF50' : '#333',
      borderRadius: 8,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      margin: '2px',
      cursor: disabled ? 'not-allowed' : (onClick ? 'pointer' : 'default'),
      backgroundColor: isBanned ? '#ffebee' :
                      isBack ? '#1a472a' : 
                      (disabled ? '#f5f5f5' : '#fff'),
      color: isBanned ? '#c62828' :
             isBack ? '#fff' : 
             (disabled ? '#999' : '#333'),
      fontSize: '14px',
      fontWeight: 'bold',
      opacity: isBanned ? 0.7 : (disabled ? 0.6 : 1),
      transition: 'all 0.3s ease',
      transform: isHighlighted ? 'scale(1.1)' : 'scale(1)',
      boxShadow: isBanned ? '0 2px 4px rgba(255, 87, 34, 0.3)' :
                 isHighlighted ? '0 4px 8px rgba(255, 107, 53, 0.4)' : 'none',
      ...style // Allow custom styles to override
    };

    return (
      <div 
        style={cardStyle} 
        onClick={!disabled && onClick ? () => onClick(value) : undefined}
      >
        {isBack ? '?' : value}
      </div>
    );
  }

  // UI for showing player's hand with banned cards separated
  function renderHand() {
    if (!self || !self.hand) return null;
    
    return (
      <div style={{ margin: '15px 0', padding: '15px', border: '2px solid #4CAF50', borderRadius: 8, backgroundColor: '#f8fff8' }}>
        <div style={{ marginBottom: '10px' }}>
          <b>Your Hand:</b>
        </div>
        
        {/* Available cards */}
        <div style={{ marginBottom: '15px' }}>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px' }}>Available cards:</div>
          <div>
            {self.hand.filter(card => !self.banned?.includes(card)).map(card => {
              const isDisabled = 
                (phase === 1 && (self.shown?.includes(card) || self.used?.includes(card))) ||
                (phase === 2 && (!self.shown?.includes(card) || self.final !== null));
              const isSelected = 
                (phase === 1 && self.shown?.includes(card)) ||
                (phase === 2 && self.final === card);
              
              return (
                <Card
                  key={card}
                  value={card}
                  isSelected={isSelected}
                  disabled={isDisabled}
                  onClick={phase === 1 ? selectCard : phase === 2 ? selectFinal : undefined}
                />
              );
            })}
          </div>
        </div>

        {/* Banned cards - separated with visual distinction */}
        {self.banned?.length > 0 && (
          <div style={{ 
            paddingTop: '15px', 
            borderTop: '2px dashed #ff5722', 
            backgroundColor: '#fff3e0',
            margin: '0 -15px -15px -15px',
            padding: '15px',
            borderRadius: '0 0 8px 8px'
          }}>
            <div style={{ fontSize: '12px', color: '#d84315', marginBottom: '5px', fontWeight: 'bold' }}>
              🚫 Banned this round:
            </div>
            <div>
              {self.banned.map(card => (
                <Card
                  key={`banned-${card}`}
                  value={card}
                  isBanned={true}
                  disabled={true}
                />
              ))}
            </div>
            <div style={{ fontSize: '11px', color: '#666', marginTop: '5px' }}>
              These cards will be available again next round
            </div>
          </div>
        )}

        {/* Game status with auto-selection warning */}
        <div style={{ marginTop: '10px', fontSize: '14px' }}>
          {phase === 1 && (
            <div>
              <span><b>Selected:</b> {self.shown?.length || 0}/2 cards</span>
              {timer <= 10 && self.shown?.length < 2 && (
                <div style={{ color: '#ff9800', fontSize: '12px', marginTop: '3px' }}>
                  ⚠️ Lowest cards will be auto-selected in {timer}s
                </div>
              )}
            </div>
          )}
          {phase === 2 && (
            <div>
              <span><b>Final pick:</b> {self.final ?? "None selected"}</span>
              {timer <= 10 && self.final === null && (
                <div style={{ color: '#ff9800', fontSize: '12px', marginTop: '3px' }}>
                  ⚠️ Lowest card will be auto-selected in {timer}s
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Render other players' cards INCLUDING their banned cards
  function renderPlayerCards(player) {
    if (player.id === playerId) return null;
    
    return (
      <div style={{ margin: '10px 0' }}>
        <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>
          {player.name} (Points: {player.points})
        </div>
        
        {/* Main game cards */}
        <div>
          {phase === 1 ? (
            // Phase 1: Always show card backs
            <>
              {[1, 2].map(idx => (
                <Card key={`${player.id}-back-${idx}`} isBack={true} />
              ))}
              <span style={{ marginLeft: '10px', fontSize: '12px', color: '#666' }}>
                {player.shown?.length || 0}/2 selected
              </span>
            </>
          ) : phase === 2 ? (
            // Phase 2: Show 2 cards, but hide which is final
            <>
              {player.shown?.map(card => (
                <Card 
                  key={`${player.id}-${card}`} 
                  value={card}
                  isHighlighted={false} // No highlighting during selection
                />
              ))}
              <span style={{ marginLeft: '10px', fontSize: '12px', color: '#666' }}>
                Final: {player.final !== null ? "✓ Selected" : "Choosing..."}
              </span>
            </>
          ) : phase === 3 ? (
            // Phase 3: NOW reveal the final cards with highlighting
            <>
              {player.shown?.map(card => (
                <Card 
                  key={`${player.id}-${card}`} 
                  value={card}
                  isHighlighted={player.final === card} // NOW show highlighting
                />
              ))}
              <span style={{ marginLeft: '10px', fontSize: '12px', color: '#666' }}>
                Final: <strong>{player.final ?? "None"}</strong>
              </span>
            </>
          ) : null}
        </div>

        {/* Banned cards section - Make sure this renders */}
        {player.banned && player.banned.length > 0 && (
          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #ccc' }}>
            <div style={{ fontSize: '11px', color: '#666', marginBottom: '3px' }}>
              Banned this round:
            </div>
            <div>
              {player.banned.map(card => (
                <Card 
                  key={`${player.id}-banned-${card}`} 
                  value={card}
                  disabled={true}
                  isBanned={true}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- UI Render Sections ---
  // LOBBY
  if (phase === 0) {
    return (
      <div style={{ maxWidth: 480, margin: "auto", fontFamily: "sans-serif", padding: '20px' }}>
        {!room ? (
          <form onSubmit={joinRoom}>
            <h2>Join Minus One Game</h2>
            <div style={{ marginBottom: '10px' }}>
              <input 
                name="room" 
                placeholder="Room Name" 
                required 
                style={{ padding: '8px', marginRight: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
              />
            </div>
            <div style={{ marginBottom: '10px' }}>
              <input 
                name="name" 
                placeholder="Your Name" 
                required 
                style={{ padding: '8px', marginRight: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
              />
            </div>
            <button 
              type="submit"
              style={{ padding: '10px 20px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >
              Join
            </button>
            {error && <div style={{ color: "red", marginTop: '10px' }}>{error}</div>}
          </form>
        ) : (
          <>
            <h2>Room: {room}</h2>
            <p>Players:</p>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {players.map(p => (
                <li key={p.id} style={{ padding: '5px', backgroundColor: '#f9f9f9', margin: '5px 0', borderRadius: '4px' }}>
                  {p.name} {p.id === playerId && <b>(You)</b>}
                  {p.isHost && " (Host)"}
                </li>
              ))}
            </ul>
            {isHost && players.length > 1 && (
              <button 
                onClick={() => socket.emit("start-game")}
                style={{ padding: '10px 20px', backgroundColor: '#2196F3', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
              >
                Start Game
              </button>
            )}
            {isHost && players.length <= 1 && <p>At least 2 players required to start</p>}
            {!isHost && <p>Waiting for host to start the game...</p>}
            {error && <div style={{ color: "red" }}>{error}</div>}
          </>
        )}
      </div>
    );
  }

  // GAME PHASES
  return (
    <div style={{ maxWidth: 800, margin: "auto", fontFamily: "sans-serif", padding: '20px' }}>
      {/* Game Header */}
      <div style={{ textAlign: 'center', padding: '20px', backgroundColor: '#f5f5f5', borderRadius: '8px', marginBottom: '20px' }}>
        <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '10px' }}>
          Room: {room} | Round: {round}
        </div>
        <div style={{ fontSize: '18px', marginBottom: '10px' }}>
          Phase: {phase === 1 ? "Select 2 cards" :
            phase === 2 ? "Pick 1 final card" :
              phase === 3 ? "Revealing final cards" :
                phase === 99 ? "Game Over" : ""}
        </div>
        <div style={{ fontSize: '16px', color: timer <= 10 ? '#ff6b35' : '#333' }}>
          Timer: {timer} seconds
        </div>

        {/* Replenishment indicator */}
        {(() => {
          const roundsUntilReplenish = 6 - ((round - 1) % 6);
          const nextReplenishRound = round + roundsUntilReplenish;
          if (roundsUntilReplenish <= 3 && phase !== 99) {
            return (
              <div style={{
                fontSize: '12px',
                color: '#ff9800',
                marginTop: '5px',
                padding: '5px',
                backgroundColor: '#fff3e0',
                borderRadius: '4px'
              }}>
                🎴 Cards will be replenished in {roundsUntilReplenish} round{roundsUntilReplenish !== 1 ? 's' : ''} (Round {nextReplenishRound})
              </div>
            );
          }
          return null;
        })()}
      </div>

      {/* Phase Instructions */}
      {phase === 1 && (
        <div style={{ border: "2px solid #2196F3", margin: "10px 0", padding: 15, borderRadius: '8px', backgroundColor: '#e3f2fd' }}>
          <b>Phase 1:</b> Select <span style={{ color: "#1976d2" }}>2 cards</span> from your hand.<br />
          They will be revealed when all players pick or after {timer} seconds.
        </div>
      )}
      {phase === 2 && (
        <div style={{ border: "2px solid #4CAF50", margin: "10px 0", padding: 15, borderRadius: '8px', backgroundColor: '#e8f5e8' }}>
          <b>Phase 2:</b> From your shown two, pick your <span style={{ color: "#2e7d32" }}>final</span> card.<br />
          Final picks will be revealed when all players choose or after {timer} seconds.
        </div>
      )}
      {phase === 3 && (
        <div style={{ border: "2px solid #ff6b35", margin: "10px 0", padding: 15, borderRadius: '8px', backgroundColor: '#fff3e0' }}>
          <b>Revealing:</b> Final card selections are now revealed!<br />
          Calculating round winner...
        </div>
      )}
      {phase === 99 && (
        <div style={{ border: "3px solid #ff6b35", background: "#fff3e0", padding: 20, margin: "10px 0", borderRadius: '8px', textAlign: 'center' }}>
          <h2 style={{ color: '#ff6b35', margin: '0 0 10px 0' }}>🎉 Game Over! 🎉</h2>
          <div style={{ fontSize: '18px' }}>Winner: <b>{winner}</b></div>
        </div>
      )}

      {/* Round Result Popup */}
      {showingResult && result && (
        <div style={{ 
          position: 'fixed', 
          top: '50%', 
          left: '50%', 
          transform: 'translate(-50%, -50%)',
          backgroundColor: '#4CAF50',
          color: 'white',
          padding: '20px',
          borderRadius: '8px',
          fontSize: '18px',
          fontWeight: 'bold',
          zIndex: 1000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
        }}>
          🏆 {result}
        </div>
      )}

      {/* Player's Hand */}
      {renderHand()}

      {/* All Players' Cards */}
      <div style={{ marginTop: 20 }}>
        <h3>All Players:</h3>
        <div style={{ display: 'grid', gap: '15px' }}>
          {players.map(p => (
            <div key={p.id} style={{ 
              padding: '15px', 
              border: p.id === playerId ? '2px solid #4CAF50' : '1px solid #ddd', 
              borderRadius: '8px',
              backgroundColor: p.id === playerId ? '#e8f5e8' : '#f9f9f9'
            }}>
              {p.id === playerId ? (
                <div style={{ fontWeight: 'bold', marginBottom: '10px', color: '#2e7d32' }}>
                  You | Points: {p.points}
                </div>
              ) : (
                renderPlayerCards(p)
              )}
            </div>
          ))}
        </div>
      </div>

      {error && <div style={{ color: "red", marginTop: 10, textAlign: 'center' }}>{error}</div>}
    </div>
  );
}

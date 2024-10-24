// Required dependencies
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http);
const path = require('path');

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Game state management
const players = new Map();
const gameState = {
	stars: [],
	maxStars: 8
};

// Star creation helper function
function createStar() {
	return {
		id: Math.random().toString(36).substr(2, 9),
		x: Math.random() * 640,
		y: 0,
		speed: 2 + Math.random() * 3,
		radius: 10,
		color: `hsl(${Math.random() * 360}, 100%, 50%)`
	};
}

// Initialize stars
for (let i = 0; i < gameState.maxStars; i++) {
	gameState.stars.push(createStar());
}

// Game loop
const gameLoop = setInterval(() => {
	// Update star positions
	gameState.stars.forEach(star => {
		star.y += star.speed;
		if (star.y > 480) {
			star.y = 0;
			star.x = Math.random() * 640;
		}
	});

	// Broadcast game state to all clients
	io.emit('gameState', {
		players: Array.from(players.values()),
		stars: gameState.stars
	});
}, 16);

// Socket connection handling
io.on('connection', (socket) => {
	console.log('Player connected:', socket.id);

	// Initialize new player
	const newPlayer = {
		id: socket.id,
		position: { x: 0, y: 0 },
		score: 0,
		name: `Player ${players.size + 1}`
	};
	players.set(socket.id, newPlayer);

	// Send initial game state to new player
	socket.emit('gameInit', {
		playerId: socket.id,
		players: Array.from(players.values()),
		stars: gameState.stars
	});

	// Handle player movement
	socket.on('playerMove', (position) => {
		if (!position || typeof position.x !== 'number' || typeof position.y !== 'number') return;

		const player = players.get(socket.id);
		if (player) {
			player.position = position;

			// Check for star collisions
			gameState.stars.forEach(star => {
				const dx = star.x - position.x;
				const dy = star.y - position.y;
				const distance = Math.sqrt(dx * dx + dy * dy);

				if (distance < star.radius + 30) {
					player.score += 10;
					star.y = 0;
					star.x = Math.random() * 640;
					io.emit('starCaught', {
						playerId: socket.id,
						newScore: player.score
					});
				}
			});
		}
	});

	// Handle player name update
	socket.on('updateName', (name) => {
		if (typeof name !== 'string') return;

		const player = players.get(socket.id);
		if (player) {
			player.name = name.slice(0, 20); // Limit name length
		}
	});

	// Handle disconnection
	socket.on('disconnect', () => {
		console.log('Player disconnected:', socket.id);
		players.delete(socket.id);
		io.emit('playerDisconnected', socket.id);
	});
});

// Error handling
process.on('uncaughtException', (err) => {
	console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
	console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});

// Cleanup on server shutdown
process.on('SIGTERM', () => {
	clearInterval(gameLoop);
	http.close(() => {
		console.log('Server shut down');
		process.exit(0);
	});
});
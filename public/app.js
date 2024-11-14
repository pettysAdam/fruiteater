const socket = io();
const video = document.getElementById('webcamVideo');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const startButton = document.getElementById('startButton');
const nameInput = document.getElementById('nameInput');
const scoreboard = document.getElementById('scoreboard');

let isGameRunning = false;
let playerId = null;
let players = new Map();
let stars = [];
let faceMesh = null;
let camera = null;
let lastFacePosition = null;
let mouthArea = null;
let mouthOpen = false;
let debugMode = false; // Set to false to disable wireframe
let playerNamePosition = null;
let fruits = [];

// Load fruit images
const fruitImages = {
	apple: new Image(),
	blueberry: new Image(),
	lemon: new Image(),
	orange: new Image(),
	raspberry: new Image(),
	strawberry: new Image()
};

fruitImages.apple.src = 'fruits/apple.png';
fruitImages.blueberry.src = 'fruits/blueberry.png';
fruitImages.lemon.src = 'fruits/lemon.png';
fruitImages.orange.src = 'fruits/orange.png';
fruitImages.raspberry.src = 'fruits/raspberry.png';
fruitImages.strawberry.src = 'fruits/strawberry.png';


// Initialize webcam and face detection on page load
document.addEventListener('DOMContentLoaded', initializeWebcam);

// Socket event handlers
socket.on('gameInit', (data) => {
	playerId = data.playerId;
	players = new Map(data.players.map(p => [p.id, p]));
	fruits = data.fruits || []; // Ensure fruits is an array
	updateScoreboard();
});

socket.on('gameState', (data) => {
	players = new Map(data.players.map(p => [p.id, p]));
	fruits = data.fruits || []; // Ensure fruits is an array
	updateScoreboard();
});

// Draw fruits
fruits.forEach(fruit => {
	const fruitImage = fruitImages[fruit.type];
	if (fruitImage) {
		ctx.drawImage(fruitImage, fruit.x - fruit.radius, fruit.y - fruit.radius, fruit.radius * 2, fruit.radius * 2);
	}
});

socket.on('playerDisconnected', (disconnectedId) => {
	players.delete(disconnectedId);
	updateScoreboard();
});

function updateScoreboard() {
	scoreboard.innerHTML = '<h3>Scoreboard</h3>' +
		Array.from(players.values())
			.sort((a, b) => b.score - a.score)
			.map(player => `
                <div class="player-score">
                    ${player.name}: ${player.score}
                    ${player.id === playerId ? ' (You)' : ''}
                </div>
            `)
			.join('');
}

// Initialize webcam and basic video display
async function initializeWebcam() {
	try {
		// Disable start button until webcam is ready
		startButton.disabled = true;
		startButton.textContent = 'Initializing Camera...';

		// Request camera access
		const stream = await navigator.mediaDevices.getUserMedia({
			video: {
				width: 640,
				height: 480,
				facingMode: 'user'
			}
		});

		// Set up video stream
		video.srcObject = stream;
		await video.play();

		// Initialize canvas size to match video
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;

		// Start showing webcam feed on canvas
		drawWebcamFeed();

		// Initialize FaceMesh after webcam is ready
		const initialized = await initializeFaceMesh();
		if (initialized) {
			startButton.disabled = false;
			startButton.textContent = 'Start Game';
			// Start camera feed processing but not game logic
			camera.start();
		} else {
			throw new Error('Failed to initialize FaceMesh');
		}

	} catch (error) {
		console.error('Error initializing webcam:', error);
		startButton.textContent = 'Camera Error';
		startButton.disabled = true;
		showError('Please grant camera access to play the game');
	}
}

// Draw webcam feed on canvas (before game starts)
function drawWebcamFeed() {
	if (!isGameRunning) {
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(video, 0, 0);

		// Add helpful text overlay
		ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
		ctx.fillRect(0, canvas.height - 40, canvas.width, 40);
		ctx.fillStyle = 'white';
		ctx.font = '16px Arial';
		ctx.textAlign = 'center';
		ctx.fillText('Position your face in the camera to start', canvas.width / 2, canvas.height - 15);

		if (!isGameRunning) {
			requestAnimationFrame(drawWebcamFeed);
		}
	}
}

function showError(message) {
	const errorDiv = document.createElement('div');
	errorDiv.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background-color: #ff4444;
        color: white;
        padding: 15px;
        border-radius: 5px;
        z-index: 1000;
    `;
	errorDiv.textContent = message;
	document.body.appendChild(errorDiv);
	setTimeout(() => errorDiv.remove(), 5000);
}

async function initializeFaceMesh() {
	try {
		faceMesh = new FaceMesh({
			locateFile: (file) => {
				return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
			}
		});

		faceMesh.setOptions({
			maxNumFaces: 1,
			refineLandmarks: true,
			minDetectionConfidence: 0.5,
			minTrackingConfidence: 0.5
		});

		faceMesh.onResults(onResults);

		// Create new camera instance
		camera = new Camera(video, {
			onFrame: async () => {
				if (faceMesh) {
					await faceMesh.send({ image: video });
				}
			},
			width: 640,
			height: 480
		});

		// Wait for FaceMesh to load
		await faceMesh.initialize();

		return true;
	} catch (error) {
		console.error('Error initializing FaceMesh:', error);
		return false;
	}
}

function faceNotInView() {
	isGameRunning = false;
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(video, 0, 0, canvas.width, canvas.height); // Draw webcam feed as background
	ctx.fillStyle = 'red';
	ctx.font = '30px Arial';
	ctx.textAlign = 'center';
	ctx.fillText('No face detected', canvas.width / 2, canvas.height / 2);
}

function onResults(results) {
	if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
		const face = results.multiFaceLandmarks[0];

		// Get mouth area using multiple points to create a more accurate hitbox
		const upperLip = face[13];  // Upper lip center
		const lowerLip = face[14];  // Lower lip center
		const leftCorner = face[78];  // Left mouth corner
		const rightCorner = face[308]; // Right mouth corner

		// Calculate mouth area boundaries
		mouthArea = {
			top: (upperLip.y * canvas.height) - 10, // Add some padding
			bottom: (lowerLip.y * canvas.height) + 10,
			left: (leftCorner.x * canvas.width) - 5,
			right: (rightCorner.x * canvas.width) + 5
		};

		// Calculate mouth openness
		const mouthHeight = mouthArea.bottom - mouthArea.top;
		mouthOpen = mouthHeight > 20; // Adjust threshold as needed

		// Center position for player representation
		const mouthPosition = {
			x: (mouthArea.left + mouthArea.right) / 2,
			y: (mouthArea.top + mouthArea.bottom) / 2
		};

		lastFacePosition = mouthPosition;

		if (isGameRunning) {
			socket.emit('playerMove', mouthPosition);
			checkFruitCollisions();
		}

		if (debugMode) {
			drawDebugInfo(face);
		}
	} else {
		lastFacePosition = null;
		if (isGameRunning) {
			faceNotInView();
		}
	}
}

function drawDebugInfo(face) {
	// Clear canvas and draw video frame
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

	// Draw face wireframe
	drawFaceWireframe(face);

	// Draw mouth hitbox
	drawMouthHitbox();
}

// Draw face wireframe for debugging
function drawFaceWireframe(face) {
	ctx.strokeStyle = 'lime';
	ctx.lineWidth = 1;

	// Draw face mesh connections
	for (let i = 0; i < face.length; i++) {
		const point = face[i];
		ctx.beginPath();
		ctx.arc(point.x * canvas.width, point.y * canvas.height, 2, 0, Math.PI * 2);
		ctx.fillStyle = 'yellow';
		ctx.fill();
	}

	playerNamePosition = face[10].y * canvas.height;

	// Highlight key facial features
	const keyPoints = {
		leftEye: face[33],
		rightEye: face[263],
		nose: face[1],
		mouth: face[13]
	};

	for (const [feature, point] of Object.entries(keyPoints)) {
		ctx.beginPath();
		ctx.arc(point.x * canvas.width, point.y * canvas.height, 5, 0, Math.PI * 2);
		ctx.fillStyle = 'red';
		ctx.fill();
		ctx.fillStyle = 'white';
		ctx.font = '12px Arial';
		ctx.fillText(feature, point.x * canvas.width + 10, point.y * canvas.height);
	}
}

async function startGame() {
	if (!video.srcObject) {
		showError('Camera not initialized. Please refresh the page.');
		return;
	}

	if (!lastFacePosition) {
		showError('Please position your face in the camera view');
		return;
	}

	const playerName = nameInput.value.trim();
	if (!playerName) {
		showError('Please enter your name before starting');
		return;
	}

	try {
		isGameRunning = true;
		startButton.textContent = 'Stop Game';

		// Send player name to the server
		socket.emit('startGame', { playerId, playerName });

		gameLoop();
	} catch (error) {
		console.error('Error starting game:', error);
		showError('Failed to start game. Please try again.');
		stopGame();
	}
}

function stopGame() {
	isGameRunning = false;
	startButton.textContent = 'Start Game';
	const stream = video.srcObject;
	if (stream) {
		stream.getTracks().forEach(track => track.stop());
	}
	ctx.clearRect(0, 0, canvas.width, canvas.height);
}

async function initializeGame() {
	await initializeFaceMesh();
	await camera.start();
}

function drawMouthHitbox() {
	if (lastFacePosition && debugMode) {
		// Calculate ellipse parameters
		const centerX = (mouthArea.left + mouthArea.right) / 2;
		const centerY = (mouthArea.top + mouthArea.bottom) / 2;
		const radiusX = (mouthArea.right - mouthArea.left) / 2;
		const radiusY = (mouthArea.bottom - mouthArea.top) / 2;

		// Draw mouth area ellipse
		ctx.beginPath();
		ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
		ctx.strokeStyle = mouthOpen ? 'lime' : 'yellow';
		ctx.lineWidth = 2;
		ctx.stroke();
	}
}

function checkFruitCollisions() {
	fruits.forEach(fruit => {
		if (isFruitInMouth(fruit)) {
			// Emit fruit caught event only if mouth is open
			if (mouthOpen) {
				socket.emit('fruitCaught', {
					fruitId: fruit.id,
					playerId: playerId
				});
			}
		}
	});
}

function isFruitInMouth(fruit) {
	const centerX = (mouthArea.left + mouthArea.right) / 2;
	const centerY = (mouthArea.top + mouthArea.bottom) / 2;
	const radiusX = (mouthArea.right - mouthArea.left) / 2;
	const radiusY = (mouthArea.bottom - mouthArea.top) / 2;

	// Check if the fruit is within the ellipse
	const dx = fruit.x - centerX;
	const dy = fruit.y - centerY;
	return (dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY) <= 1;
}

function gameLoop() {
	if (!isGameRunning) return;

	// Clear canvas
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	// Draw video frame
	ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

	// Draw fruits
	fruits.forEach(fruit => {
		const fruitImage = fruitImages[fruit.type];
		if (fruitImage) {
			ctx.drawImage(fruitImage, fruit.x - fruit.radius, fruit.y - fruit.radius, fruit.radius * 3, fruit.radius * 3);
		}
	});

	// Draw all players
	players.forEach(player => {
		if (player.position) {
			// Draw player avatar
			ctx.beginPath();
			ctx.arc(player.position.x, player.position.y, 10, 0, Math.PI * 2);
			ctx.fillStyle = player.id === playerId ? 'red' : 'blue';
			ctx.fill();
			ctx.closePath();

			// Draw player name above their head
			ctx.fillStyle = 'white';
			ctx.font = '14px Arial';
			ctx.textAlign = 'center';
			ctx.fillText(player.name, player.position.x, player.position.y - 20);
		}
	});

	// If in debug mode, draw mouth hitbox and other debug info
	if (debugMode && lastFacePosition) {
		drawDebugInfo(lastFacePosition);
	}

	requestAnimationFrame(gameLoop);
}

// Add this code to handle the debug mode toggle
const debugToggle = document.getElementById('debugToggle');
debugToggle.addEventListener('change', (event) => {
	debugMode = event.target.checked;
});

startButton.addEventListener('click', async () => {
	if (!isGameRunning) {
		await initializeGame();
		await startGame();
	} else {
		stopGame();
	}
});
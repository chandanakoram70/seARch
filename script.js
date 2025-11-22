document.addEventListener('DOMContentLoaded', () => {
    console.log('[DEBUG] DOMContentLoaded event fired');
    
    
    const App = {
        state: {
            currentFloor: 1,
            allLocations: new Map(),
            floorData: new Map(),
            html5QrScanner: null,
            currentPath: null,
            currentSource: null,
            currentDestination: null,
            videoStream: null,
            deviceOrientation: { alpha: 0, beta: 0, gamma: 0 },
            deviceMotion: {
                acceleration: { x: 0, y: 0, z: 0 },
                stepCount: 0,
                lastStepTime: 0,
                stepThreshold: 1.2, 
                averageStepLength: 0.7 
            },
            currentPosition: null, 
            distanceToDestination: 0,
            testMode: {
                enabled: false,
                simulatedHeading: 0,
                currentPosition: null,
                currentWaypointIndex: 0
            }
        },
        ui: {
            loadingOverlay: document.getElementById('loading-overlay'),
            mainContainer: document.getElementById('main-container'),
            arContainer: document.getElementById('ar-container'),
            floorSelect: document.getElementById('floor-select'),
            sourceSelect: document.getElementById('source-location'),
            destinationSelect: document.getElementById('destination-location'),
            calculatePathButton: document.getElementById('calculate-path-button'),
            scanQrButton: document.getElementById('scan-qr-button'),
            resultsContainer: document.getElementById('results-container'),
            pathPreview: document.getElementById('path-preview'),
            pathDescription: document.getElementById('path-description'),
            pathDetails: document.getElementById('path-details'),
            startArButton: document.getElementById('start-ar-button'),
            exitArButton: document.getElementById('exit-ar-button'),
            arInstructions: document.getElementById('ar-instructions'),
            distanceInfo: document.getElementById('distance-info'),
            arCanvas: document.getElementById('ar-canvas'),
            qr: {
                modal: document.getElementById('qr-scanner-modal'),
                closeButton: document.getElementById('close-qr-button'),
            }
        },
    };
    
    console.log('[DEBUG] App object initialized:', {
        hasLoadingOverlay: !!App.ui.loadingOverlay,
        hasMainContainer: !!App.ui.mainContainer,
        hasFloorSelect: !!App.ui.floorSelect,
        hasSourceSelect: !!App.ui.sourceSelect,
        hasDestinationSelect: !!App.ui.destinationSelect,
        hasCalculateButton: !!App.ui.calculatePathButton,
        hasPathPreview: !!App.ui.pathPreview,
        hasStartArButton: !!App.ui.startArButton,
        hasArCanvas: !!App.ui.arCanvas
    });

    

    async function loadFloorData(floorNumber) {
        console.log(`[DEBUG] loadFloorData called for floor ${floorNumber}`);
        
        if (App.state.floorData.has(floorNumber)) {
            console.log(`[DEBUG] Floor ${floorNumber} already loaded from cache`);
            return App.state.floorData.get(floorNumber);
        }
        
        try {
            console.log(`[DEBUG] Fetching data for floor ${floorNumber}...`);
            
            const folderName = floorNumber === 'test_area' ? 'test_area' : `floor_${floorNumber}`;
            
            const [navMeshResponse, locationsResponse] = await Promise.all([
                fetch(`./data/${folderName}/navmesh.json`),
                fetch(`./data/${folderName}/locations.json`),
            ]);
            
            console.log(`[DEBUG] Fetch responses:`, {
                navMeshOk: navMeshResponse.ok,
                navMeshStatus: navMeshResponse.status,
                locationsOk: locationsResponse.ok,
                locationsStatus: locationsResponse.status
            });
            
            if (!navMeshResponse.ok || !locationsResponse.ok) {
                throw new Error(`Could not load data for floor ${floorNumber}`);
            }
            
            const navMeshData = await navMeshResponse.json();
            const locationsData = await locationsResponse.json();
            
            console.log(`[DEBUG] Floor ${floorNumber} data loaded:`, {
                navMeshVertices: navMeshData?.vertices?.length || 0,
                locationsCount: locationsData?.length || 0,
                locations: locationsData.map(l => l.id)
            });

            locationsData.forEach(loc => App.state.allLocations.set(loc.id, loc));
            const floorInfo = { 
                navMesh: navMeshData, 
                locations: locationsData, 
                pathfinder: createPathfinder(navMeshData) 
            };
            App.state.floorData.set(floorNumber, floorInfo);
            
            console.log(`[DEBUG] Floor ${floorNumber} data stored in state. Total locations: ${App.state.allLocations.size}`);
            return floorInfo;
        } catch (error) {
            console.error(`[ERROR] Failed to load floor ${floorNumber}:`, error);
            App.ui.resultsContainer.textContent = `Error: ${error.message}`;
            return null;
        }
    }

    function populateDropdowns() {
        console.log('[DEBUG] populateDropdowns called');
        const currentFloorInfo = App.state.floorData.get(App.state.currentFloor);
        
        if (!currentFloorInfo) {
            console.warn(`[WARN] No floor info for floor ${App.state.currentFloor}`);
            return;
        }
        
        console.log(`[DEBUG] Populating dropdowns for floor ${App.state.currentFloor}`, {
            locationsCount: currentFloorInfo.locations.length,
            totalFloors: App.state.floorData.size
        });

        App.ui.sourceSelect.innerHTML = '<option value="">Select a starting point...</option>';
        currentFloorInfo.locations.forEach(location => {
            App.ui.sourceSelect.add(new Option(location.name, location.id));
        });
        console.log(`[DEBUG] Source dropdown populated with ${currentFloorInfo.locations.length} locations`);
        console.log(`[DEBUG] Source dropdown now has ${App.ui.sourceSelect.options.length} options`);
        console.log(`[DEBUG] First 3 source options:`, Array.from(App.ui.sourceSelect.options).slice(0, 3).map(o => ({text: o.text, value: o.value})));

        App.ui.destinationSelect.innerHTML = '<option value="">Select a destination...</option>';
        const sortedFloors = Array.from(App.state.floorData.keys()).sort((a, b) => {
            if (a === 'test_area') return 1;
            if (b === 'test_area') return -1;
            return a - b;
        });
        console.log(`[DEBUG] Populating destination dropdown for floors: ${sortedFloors}`);
        
        for (const floorNum of sortedFloors) {
            const floorInfo = App.state.floorData.get(floorNum);
            const optgroup = document.createElement('optgroup');
            optgroup.label = `Floor ${floorNum}`;
            floorInfo.locations.forEach(location => {
                optgroup.appendChild(new Option(location.name, location.id));
            });
            App.ui.destinationSelect.appendChild(optgroup);
            console.log(`[DEBUG] Added ${floorInfo.locations.length} locations for Floor ${floorNum}`);
        }
        
        console.log(`[DEBUG] Destination dropdown now has ${App.ui.destinationSelect.options.length} options total`);
        console.log('[DEBUG] Dropdown population complete');
    }

    

    function createPathfinder(navMeshData) {
        console.log('[DEBUG] createPathfinder called', {
            hasNavMesh: !!navMeshData,
            hasVertices: !!navMeshData?.vertices,
            vertexCount: navMeshData?.vertices?.length || 0
        });

        
        
        return {
            findPath: (start, end) => {
                console.log('[DEBUG] findPath called', { start, end });
                
                
                const dx = end.x - start.x;
                const dz = end.z - start.z;
                const totalDistance = Math.sqrt(dx * dx + dz * dz);
                
                console.log('[DEBUG] Straight-line distance:', totalDistance.toFixed(2), 'meters');
                
                
                const waypointInterval = 5; 
                const numWaypoints = Math.max(2, Math.ceil(totalDistance / waypointInterval));
                
                const path = [];
                for (let i = 0; i <= numWaypoints; i++) {
                    const t = i / numWaypoints;
                    path.push({
                        x: start.x + dx * t,
                        y: (start.y || 0) + ((end.y || 0) - (start.y || 0)) * t,
                        z: start.z + dz * t
                    });
                }
                
                console.log(`[DEBUG] Generated path with ${path.length} waypoints, total distance: ${totalDistance.toFixed(2)}m`);
                return path;
            }
        };
    }
    
    function calculatePath() {
        console.log('[DEBUG] calculatePath called');
        const sourceId = App.ui.sourceSelect.value;
        const destinationId = App.ui.destinationSelect.value;
        
        console.log('[DEBUG] Selected IDs:', { sourceId, destinationId });
        
        if (!sourceId || !destinationId) {
            console.warn('[WARN] Missing source or destination');
            App.ui.resultsContainer.textContent = 'Please select both a start and end location.';
            return;
        }
        
        if (sourceId === destinationId) {
            console.warn('[WARN] Source and destination are the same');
            App.ui.resultsContainer.textContent = 'Source and destination cannot be the same.';
            return;
        }

        const sourceLoc = App.state.allLocations.get(sourceId);
        const destLoc = App.state.allLocations.get(destinationId);
        
        console.log('[DEBUG] Retrieved locations:', {
            source: sourceLoc ? `${sourceLoc.name} (floor ${sourceLoc.floor})` : 'NOT FOUND',
            destination: destLoc ? `${destLoc.name} (floor ${destLoc.floor})` : 'NOT FOUND'
        });

        if (!sourceLoc || !destLoc) {
            console.error('[ERROR] Could not find location in allLocations map');
            App.ui.resultsContainer.textContent = 'Error: Location data not found.';
            return;
        }

        App.state.currentSource = sourceLoc;
        App.state.currentDestination = destLoc;
        
        console.log('[DEBUG] Calculating path...', {
            sameFloor: sourceLoc.floor === destLoc.floor
        });

        if (sourceLoc.floor === destLoc.floor) {
            console.log('[DEBUG] Same floor navigation');
            const floorInfo = App.state.floorData.get(sourceLoc.floor);
            
            if (!floorInfo || !floorInfo.pathfinder) {
                console.error('[ERROR] Pathfinder not available for floor', sourceLoc.floor);
                App.ui.resultsContainer.textContent = 'Pathfinding data not available.';
                return;
            }
            
            console.log('[DEBUG] Calling pathfinder.findPath...');
            const path = floorInfo.pathfinder.findPath(sourceLoc.pos, destLoc.pos);
            
            if (!path || path.length === 0) {
                console.error('[ERROR] No path found');
                App.ui.resultsContainer.textContent = `No path could be found to ${destLoc.name}.`;
                return;
            }
            
            console.log('[DEBUG] Path found successfully, displaying preview');
            App.state.currentPath = path;
            displayPathPreview(sourceLoc, destLoc, path, false);
        } else {
            console.log('[DEBUG] Multi-floor navigation');
            const startFloorInfo = App.state.floorData.get(sourceLoc.floor);
            const connectors = startFloorInfo.locations.filter(l => l.type === 'connector');
            
            console.log('[DEBUG] Found connectors:', connectors.map(c => c.name));
            let bestPathToConnector = null, chosenConnector = null;

            for (const connector of connectors) {
                console.log(`[DEBUG] Testing path to connector: ${connector.name}`);
                const path = startFloorInfo.pathfinder.findPath(sourceLoc.pos, connector.pos);
                if (path && (!bestPathToConnector || path.length < bestPathToConnector.length)) {
                    bestPathToConnector = path;
                    chosenConnector = connector;
                    console.log(`[DEBUG] New best path to ${connector.name}`);
                }
            }
            
            if (!bestPathToConnector) {
                console.error('[ERROR] No path to any connector found');
                App.ui.resultsContainer.textContent = 'Could not find a path to stairs or an elevator.';
                return;
            }
            
            console.log(`[DEBUG] Best path found via ${chosenConnector.name}`);
            App.state.currentPath = bestPathToConnector;
            displayPathPreview(sourceLoc, destLoc, bestPathToConnector, true, chosenConnector);
        }
    }

    function displayPathPreview(source, dest, path, isMultiFloor, connector) {
        console.log('[DEBUG] displayPathPreview called', {
            source: source.name,
            dest: dest.name,
            pathLength: path.length,
            isMultiFloor,
            connector: connector?.name
        });
        
        App.ui.resultsContainer.textContent = '';
        App.ui.pathPreview.classList.remove('hidden');
        
        const distance = calculatePathDistance(path);
        console.log(`[DEBUG] Calculated distance: ${distance.toFixed(1)}m`);
        
        if (isMultiFloor) {
            App.ui.pathDescription.textContent = 
                `${source.name} → ${connector.name} → Floor ${dest.floor} → ${dest.name}`;
            App.ui.pathDetails.innerHTML = `
                <p><strong>Distance to ${connector.name}:</strong> ${distance.toFixed(1)}m</p>
                <p><strong>Instructions:</strong> Follow the AR path to ${connector.name}, 
                then proceed to Floor ${dest.floor} to reach ${dest.name}.</p>
            `;
        } else {
            App.ui.pathDescription.textContent = `${source.name} → ${dest.name}`;
            App.ui.pathDetails.innerHTML = `
                <p><strong>Distance:</strong> ${distance.toFixed(1)}m</p>
                <p><strong>Waypoints:</strong> ${path.length}</p>
            `;
        }
        
        console.log('[DEBUG] Path preview displayed');
    }

    function calculatePathDistance(path) {
        let distance = 0;
        for (let i = 1; i < path.length; i++) {
            const dx = path[i].x - path[i-1].x;
            const dy = path[i].y - path[i-1].y;
            const dz = path[i].z - path[i-1].z;
            distance += Math.sqrt(dx*dx + dy*dy + dz*dz);
        }
        return distance;
    }

    

    async function startARNavigation() {
        console.log('[DEBUG] startARNavigation called');
        
        if (!App.state.currentPath) {
            console.warn('[WARN] No path calculated yet');
            App.ui.resultsContainer.textContent = 'Please calculate a path first.';
            return;
        }
        
        console.log('[DEBUG] Current path exists, waypoints:', App.state.currentPath.length);

        try {
            console.log('[DEBUG] Requesting camera access...');
            App.state.videoStream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });
            
            console.log('[DEBUG] Camera access granted');

            App.ui.mainContainer.classList.add('hidden');
            App.ui.arContainer.classList.remove('hidden');
            console.log('[DEBUG] Switched to AR view');
            
            setupARCanvas();
            setupTestControls();
            
            console.log('[DEBUG] Checking for device orientation API...');
            if (typeof DeviceOrientationEvent !== 'undefined' && 
                typeof DeviceOrientationEvent.requestPermission === 'function') {
                console.log('[DEBUG] iOS-style permission required');
                try {
                    const permission = await DeviceOrientationEvent.requestPermission();
                    console.log('[DEBUG] Device orientation permission:', permission);
                    if (permission === 'granted') {
                        window.addEventListener('deviceorientation', handleOrientation);
                    }
                } catch (err) {
                    console.error('[ERROR] Device orientation permission denied:', err);
                }
            } else {
                console.log('[DEBUG] Adding device orientation listener (no permission needed)');
                window.addEventListener('deviceorientation', handleOrientation);
            }

            
            App.state.currentPosition = { ...App.state.currentSource.pos };
            const dx = App.state.currentDestination.pos.x - App.state.currentPosition.x;
            const dz = App.state.currentDestination.pos.z - App.state.currentPosition.z;
            App.state.distanceToDestination = Math.sqrt(dx * dx + dz * dz);
            console.log('[DEBUG] Initialized position tracking, initial distance:', 
                App.state.distanceToDestination.toFixed(2));

            
            console.log('[DEBUG] Adding device motion listener...');
            window.addEventListener('devicemotion', handleMotion);

            console.log('[DEBUG] Starting AR render loop...');
            startARRenderLoop();
            
        } catch (error) {
            console.error('[ERROR] Failed to start AR:', error);
            App.ui.resultsContainer.textContent = 'Camera permission denied or not available.';
            exitARView();
        }
    }

    function setupTestControls() {
        console.log('[DEBUG] Setting up test controls');
        
        const enableTestBtn = document.getElementById('enable-test-mode');
        const rotationControls = document.getElementById('rotation-controls');
        const movementControls = document.getElementById('movement-controls');
        const rotateLeftBtn = document.getElementById('rotate-left');
        const rotateRightBtn = document.getElementById('rotate-right');
        const walkForwardBtn = document.getElementById('walk-forward');
        const testHeadingDisplay = document.getElementById('test-heading');
        const waypointInfo = document.getElementById('waypoint-info');
        
        
        if (App.state.currentSource && App.state.currentSource.pos) {
            App.state.testMode.currentPosition = { ...App.state.currentSource.pos };
            App.state.testMode.currentWaypointIndex = 0;
            console.log('[DEBUG] Initialized test position:', App.state.testMode.currentPosition);
        }
        
        enableTestBtn.addEventListener('click', () => {
            App.state.testMode.enabled = !App.state.testMode.enabled;
            
            if (App.state.testMode.enabled) {
                enableTestBtn.textContent = 'Disable Test Mode';
                enableTestBtn.style.backgroundColor = 'rgba(50, 200, 50, 0.9)';
                rotationControls.style.display = 'flex';
                movementControls.style.display = 'flex';
                
                
                if (App.state.currentSource && App.state.currentSource.pos) {
                    App.state.testMode.currentPosition = { ...App.state.currentSource.pos };
                    App.state.testMode.currentWaypointIndex = 0;
                }
                
                updateWaypointInfo();
                console.log('[DEBUG] Test mode ENABLED');
            } else {
                enableTestBtn.textContent = 'Enable Test Mode';
                enableTestBtn.style.backgroundColor = 'rgba(255, 165, 0, 0.9)';
                rotationControls.style.display = 'none';
                movementControls.style.display = 'none';
                console.log('[DEBUG] Test mode DISABLED');
            }
        });
        
        rotateLeftBtn.addEventListener('click', () => {
            App.state.testMode.simulatedHeading -= 15;
            if (App.state.testMode.simulatedHeading < 0) {
                App.state.testMode.simulatedHeading += 360;
            }
            testHeadingDisplay.textContent = `${Math.round(App.state.testMode.simulatedHeading)}°`;
            console.log('[DEBUG] Rotated left to:', App.state.testMode.simulatedHeading);
        });
        
        rotateRightBtn.addEventListener('click', () => {
            App.state.testMode.simulatedHeading += 15;
            if (App.state.testMode.simulatedHeading >= 360) {
                App.state.testMode.simulatedHeading -= 360;
            }
            testHeadingDisplay.textContent = `${Math.round(App.state.testMode.simulatedHeading)}°`;
            console.log('[DEBUG] Rotated right to:', App.state.testMode.simulatedHeading);
        });
        
        walkForwardBtn.addEventListener('click', () => {
            if (!App.state.testMode.currentPosition || !App.state.currentPath) return;
            
            const currentIdx = App.state.testMode.currentWaypointIndex;
            if (currentIdx >= App.state.currentPath.length - 1) {
                console.log('[DEBUG] Already at destination!');
                return;
            }
            
            
            const nextWaypoint = App.state.currentPath[currentIdx + 1];
            const currentPos = App.state.testMode.currentPosition;
            
            
            const dx = nextWaypoint.x - currentPos.x;
            const dz = nextWaypoint.z - currentPos.z;
            const distanceToNext = Math.sqrt(dx * dx + dz * dz);
            
            
            const moveDistance = Math.min(5, distanceToNext);
            const ratio = moveDistance / distanceToNext;
            
            App.state.testMode.currentPosition.x += dx * ratio;
            App.state.testMode.currentPosition.z += dz * ratio;
            
            
            if (moveDistance >= distanceToNext) {
                App.state.testMode.currentWaypointIndex++;
                console.log('[DEBUG] Reached waypoint', App.state.testMode.currentWaypointIndex);
            }
            
            updateWaypointInfo();
            console.log('[DEBUG] Walked forward to:', App.state.testMode.currentPosition);
        });
        
        function updateWaypointInfo() {
            if (App.state.currentPath) {
                const current = App.state.testMode.currentWaypointIndex;
                const total = App.state.currentPath.length - 1;
                waypointInfo.textContent = `Waypoint ${current}/${total}`;
            }
        }
    }

    function setupARCanvas() {
        console.log('[DEBUG] setupARCanvas called');
        const canvas = App.ui.arCanvas;
        const video = document.createElement('video');
        video.srcObject = App.state.videoStream;
        video.autoplay = true;
        video.playsInline = true;
        
        video.onloadedmetadata = () => {
            console.log('[DEBUG] Video metadata loaded:', {
                width: video.videoWidth,
                height: video.videoHeight
            });
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        };
        
        App.state.videoElement = video;
        console.log('[DEBUG] Video element created and configured');
    }

    function handleOrientation(event) {
        App.state.deviceOrientation = {
            alpha: event.alpha || 0,
            beta: event.beta || 0,
            gamma: event.gamma || 0
        };
        
        if (Math.random() < 0.01) {
            console.log('[DEBUG] Device orientation:', App.state.deviceOrientation);
        }
    }

    function handleMotion(event) {
        
        const acc = event.accelerationIncludingGravity;
        if (!acc) return;
        
        const motion = App.state.deviceMotion;
        const now = Date.now();
        
        
        const totalAcc = Math.sqrt(
            Math.pow(acc.x || 0, 2) + 
            Math.pow(acc.y || 0, 2) + 
            Math.pow(acc.z || 0, 2)
        );
        
        
        if (!motion.accHistory) {
            motion.accHistory = [];
            motion.lastAccValue = totalAcc;
        }
        
        motion.accHistory.push({ value: totalAcc, time: now });
        
        
        if (motion.accHistory.length > 10) {
            motion.accHistory.shift();
        }
        
        
        const timeSinceLastStep = now - motion.lastStepTime;
        
        
        
        if (motion.accHistory.length >= 3 && timeSinceLastStep > 300) {
            const recent = motion.accHistory.slice(-3);
            const middle = recent[1].value;
            const before = recent[0].value;
            const after = recent[2].value;
            
            
            
            const isPeak = middle > before && middle > after;
            const peakMagnitude = middle - Math.min(before, after);
            
            
            
            
            
            if (isPeak && 
                peakMagnitude > 1.0 && 
                middle > 8 && 
                middle < 20) {
                
                motion.stepCount++;
                motion.lastStepTime = now;
                
                
                updatePositionFromStep();
                
                
                const stepCounter = document.getElementById('step-counter');
                if (stepCounter) {
                    stepCounter.style.display = 'block';
                    stepCounter.textContent = `Steps: ${motion.stepCount} | ${peakMagnitude.toFixed(1)}`;
                }
                
                console.log('[DEBUG] Step detected!', {
                    stepCount: motion.stepCount,
                    peakMagnitude: peakMagnitude.toFixed(2),
                    acceleration: middle.toFixed(2),
                    timeSinceLastStep: timeSinceLastStep
                });
            }
        }
        
        
        motion.acceleration = { x: acc.x || 0, y: acc.y || 0, z: acc.z || 0 };
        motion.lastAccValue = totalAcc;
    }

    function updatePositionFromStep() {
        if (!App.state.currentPosition || !App.state.currentDestination) return;
        
        const currentPos = App.state.currentPosition;
        const heading = App.state.deviceOrientation.alpha || 0;
        const stepLength = App.state.deviceMotion.averageStepLength;
        
        
        const headingRad = heading * Math.PI / 180;
        
        
        
        currentPos.x += stepLength * Math.sin(headingRad);
        currentPos.z += stepLength * Math.cos(headingRad);
        
        
        const dx = App.state.currentDestination.pos.x - currentPos.x;
        const dz = App.state.currentDestination.pos.z - currentPos.z;
        App.state.distanceToDestination = Math.sqrt(dx * dx + dz * dz);
        
        console.log('[DEBUG] Position updated:', {
            position: `(${currentPos.x.toFixed(2)}, ${currentPos.z.toFixed(2)})`,
            heading: heading.toFixed(1),
            distance: App.state.distanceToDestination.toFixed(2)
        });
    }

    function startARRenderLoop() {
        console.log('[DEBUG] startARRenderLoop called');
        const canvas = App.ui.arCanvas;
        const ctx = canvas.getContext('2d');
        const video = App.state.videoElement;

        function render() {
            if (!App.state.videoStream) return;

            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            drawARDirections(ctx);
            requestAnimationFrame(render);
        }

        render();
    }

    function drawPathTrail(ctx, currentPos, deviceHeading, centerX, centerY) {
        const path = App.state.currentPath;
        if (!path || path.length < 2) return;

        
        let nearestIdx = 0;
        let minDist = Infinity;
        
        for (let i = 0; i < path.length; i++) {
            const wp = path[i];
            const dx = wp.x - currentPos.x;
            const dz = wp.z - currentPos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            
            if (dist < minDist) {
                minDist = dist;
                nearestIdx = i;
            }
        }

        
        const pathSegments = [];
        const maxVisibleDistance = 20; 
        
        
        pathSegments.push(currentPos);
        
        
        for (let i = nearestIdx; i < path.length; i++) {
            const wp = path[i];
            const distFromStart = Math.sqrt(
                Math.pow(wp.x - currentPos.x, 2) + 
                Math.pow(wp.z - currentPos.z, 2)
            );
            
            if (distFromStart <= maxVisibleDistance) {
                pathSegments.push(wp);
            }
        }

        if (pathSegments.length < 2) return;

        
        ctx.save();
        
        
        const screenPoints = pathSegments.map(point => {
            return projectPointToGround(point, currentPos, deviceHeading, centerX, centerY);
        }).filter(p => p !== null);

        if (screenPoints.length > 1) {
            
            ctx.strokeStyle = 'rgba(0, 255, 100, 0.3)';
            ctx.lineWidth = 20;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            
            ctx.beginPath();
            ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
            for (let i = 1; i < screenPoints.length; i++) {
                ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
            }
            ctx.stroke();
            
            
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.lineWidth = 14;
            
            ctx.beginPath();
            ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
            for (let i = 1; i < screenPoints.length; i++) {
                ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
            }
            ctx.stroke();
            
            
            ctx.strokeStyle = 'rgba(0, 255, 100, 0.95)';
            ctx.lineWidth = 10;
            
            ctx.beginPath();
            ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
            for (let i = 1; i < screenPoints.length; i++) {
                ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
            }
            ctx.stroke();
            
            
            const dashOffset = (Date.now() / 50) % 40;
            ctx.setLineDash([20, 20]);
            ctx.lineDashOffset = -dashOffset;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.lineWidth = 6;
            
            ctx.beginPath();
            ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
            for (let i = 1; i < screenPoints.length; i++) {
                ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
            }
            ctx.stroke();
            ctx.setLineDash([]);
            
            
            for (let i = 0; i < screenPoints.length - 1; i++) {
                const p1 = screenPoints[i];
                const p2 = screenPoints[i + 1];
                const segmentLength = Math.sqrt(
                    Math.pow(p2.x - p1.x, 2) + 
                    Math.pow(p2.y - p1.y, 2)
                );
                
                
                for (let ratio of [0.33, 0.66]) {
                    const px = p1.x + (p2.x - p1.x) * ratio;
                    const py = p1.y + (p2.y - p1.y) * ratio;
                    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                    
                    drawChevron(ctx, px, py, angle, 12);
                }
            }
            
            
            for (let i = 1; i < screenPoints.length; i++) {
                const point = screenPoints[i];
                
                
                const pulseScale = 1 + 0.2 * Math.sin(Date.now() / 300 + i);
                const radius = 10 * pulseScale;
                
                
                ctx.fillStyle = 'rgba(0, 255, 100, 0.3)';
                ctx.beginPath();
                ctx.arc(point.x, point.y, radius + 5, 0, 2 * Math.PI);
                ctx.fill();
                
                
                ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
                ctx.strokeStyle = 'rgba(0, 255, 100, 1)';
                ctx.lineWidth = 4;
                
                ctx.beginPath();
                ctx.arc(point.x, point.y, radius, 0, 2 * Math.PI);
                ctx.fill();
                ctx.stroke();
                
                
                ctx.fillStyle = 'rgba(0, 255, 100, 1)';
                ctx.beginPath();
                ctx.arc(point.x, point.y, radius * 0.4, 0, 2 * Math.PI);
                ctx.fill();
            }
        }
        
        ctx.restore();
    }

    function projectPointToGround(worldPos, currentPos, deviceHeading, centerX, centerY) {
        
        const dx = worldPos.x - currentPos.x;
        const dz = worldPos.z - currentPos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        
        if (distance < 0.5 || distance > 25) return null;
        
        
        let worldAngle = Math.atan2(dx, dz) * 180 / Math.PI;
        
        
        let relativeAngle = (worldAngle - deviceHeading);
        
        
        while (relativeAngle > 180) relativeAngle -= 360;
        while (relativeAngle < -180) relativeAngle += 360;
        
        
        if (Math.abs(relativeAngle) > 90) return null;
        
        
        const angleRad = relativeAngle * Math.PI / 180;
        
        
        
        const perspectiveFactor = 1 / (1 + distance * 0.05);
        const screenDist = distance * 15 * perspectiveFactor;
        
        
        
        
        const screenX = centerX + Math.sin(angleRad) * screenDist * 1.5;
        const screenY = centerY + 100 - (Math.cos(angleRad) * screenDist * 0.8);
        
        return {
            x: screenX,
            y: screenY,
            distance: distance
        };
    }

    function drawChevron(ctx, x, y, angle, size) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        
        
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        ctx.moveTo(-size * 0.5, -size * 0.5);
        ctx.lineTo(size * 0.5, 0);
        ctx.lineTo(-size * 0.5, size * 0.5);
        ctx.stroke();
        
        ctx.restore();
    }



    function drawARDirections(ctx) {
        if (!App.state.currentPath || App.state.currentPath.length < 2) {
            console.warn('[WARN] No path to draw');
            return;
        }

        const canvas = ctx.canvas;
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        
        const currentPos = App.state.testMode.enabled && App.state.testMode.currentPosition
            ? App.state.testMode.currentPosition
            : (App.state.currentPosition || App.state.currentSource.pos);
        const destinationPos = App.state.currentDestination.pos;
        
        
        const deviceHeading = App.state.testMode.enabled 
            ? App.state.testMode.simulatedHeading 
            : (App.state.deviceOrientation.alpha || 0);

        
        drawPathTrail(ctx, currentPos, deviceHeading, centerX, centerY);

        // Find target point for the arrow (look ahead on path)
        let targetPos = App.state.currentDestination.pos;
        const path = App.state.currentPath;
        
        if (path && path.length > 0) {
            // Find nearest waypoint index
            let nearestIdx = 0;
            let minDist = Infinity;
            for (let i = 0; i < path.length; i++) {
                const wp = path[i];
                const d = Math.sqrt(Math.pow(wp.x - currentPos.x, 2) + Math.pow(wp.z - currentPos.z, 2));
                if (d < minDist) {
                    minDist = d;
                    nearestIdx = i;
                }
            }
            
            // Look ahead for a waypoint that is at least X meters away
            const lookAheadDist = 4.0; // meters
            for (let i = nearestIdx; i < path.length; i++) {
                const wp = path[i];
                const d = Math.sqrt(Math.pow(wp.x - currentPos.x, 2) + Math.pow(wp.z - currentPos.z, 2));
                if (d > lookAheadDist) {
                    targetPos = wp;
                    break;
                }
            }
        }

        
        const dx = targetPos.x - currentPos.x;
        const dz = targetPos.z - currentPos.z;
        
        // Calculate distance to actual destination for display
        const destDx = App.state.currentDestination.pos.x - currentPos.x;
        const destDz = App.state.currentDestination.pos.z - currentPos.z;
        const distance = App.state.testMode.enabled 
            ? Math.sqrt(destDx*destDx + destDz*destDz)
            : App.state.distanceToDestination;
        
        
        App.ui.distanceInfo.textContent = `${distance.toFixed(1)}m to destination`;
        
        
        let targetAngle = Math.atan2(dx, dz) * 180 / Math.PI;
        
        
        let relativeAngle = targetAngle - deviceHeading;
        while (relativeAngle > 180) relativeAngle -= 360;
        while (relativeAngle < -180) relativeAngle += 360;

        console.log('[DEBUG AR]', {
            testMode: App.state.testMode.enabled,
            usingSimulatedPos: App.state.testMode.enabled && !!App.state.testMode.currentPosition,
            currentPos: `(${currentPos.x.toFixed(1)}, ${currentPos.z.toFixed(1)})`,
            destinationPos: `(${destinationPos.x.toFixed(1)}, ${destinationPos.z.toFixed(1)})`,
            distance: distance.toFixed(1),
            targetAngle: targetAngle.toFixed(1),
            deviceHeading: deviceHeading.toFixed(1),
            relativeAngle: relativeAngle.toFixed(1)
        });

        
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(relativeAngle * Math.PI / 180);

        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.moveTo(0, -85);
        ctx.lineTo(-45, 25);
        ctx.lineTo(0, 5);
        ctx.lineTo(45, 25);
        ctx.closePath();
        ctx.fill();

        
        ctx.fillStyle = 'rgba(0, 123, 255, 0.9)';
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 4;

        ctx.beginPath();
        ctx.moveTo(0, -80);
        ctx.lineTo(-40, 20);
        ctx.lineTo(0, 0);
        ctx.lineTo(40, 20);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        
        ctx.fillStyle = 'white';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('↑', 0, -50);

        ctx.restore();

        
        App.ui.distanceInfo.textContent = `Distance: ${distance.toFixed(1)}m`;

        
        ctx.fillStyle = 'rgba(0, 123, 255, 0.95)';
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 3;
        ctx.font = 'bold 28px Arial';
        ctx.textAlign = 'center';
        ctx.strokeText(`→ ${App.state.currentDestination.name}`, centerX, 60);
        ctx.fillText(`→ ${App.state.currentDestination.name}`, centerX, 60);
        
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.font = '16px Arial';
        ctx.fillText(`From: ${App.state.currentSource.name}`, centerX, 90);

        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.font = '14px monospace';
        ctx.fillText(`Target: ${targetAngle.toFixed(0)}° | Device: ${deviceHeading.toFixed(0)}° | Relative: ${relativeAngle.toFixed(0)}°`, centerX, canvas.height - 20);

        
        drawCompass(ctx, deviceHeading);
    }

    function drawCompass(ctx, heading) {
        const canvas = ctx.canvas;
        const x = canvas.width - 80;
        const y = 80;
        const radius = 50;

        ctx.save();
        ctx.translate(x, y);

        
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 4;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            ctx.moveTo(0, -radius + 5);
            ctx.lineTo(0, -radius + 15);
            ctx.stroke();
            ctx.rotate(Math.PI / 2);
        }

        
        ctx.rotate(-heading * Math.PI / 180);
        ctx.fillStyle = 'red';
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -radius + 10);
        ctx.lineTo(-10, -radius + 30);
        ctx.lineTo(10, -radius + 30);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        
        ctx.fillStyle = 'white';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('N', 0, -radius + 45);

        ctx.restore();
        
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${heading.toFixed(0)}°`, x, y + radius + 20);
    }

    function exitARView() {
        console.log('[DEBUG] exitARView called');
        App.ui.arContainer.classList.add('hidden');
        App.ui.mainContainer.classList.remove('hidden');
        
        if (App.state.videoStream) {
            console.log('[DEBUG] Stopping video stream...');
            App.state.videoStream.getTracks().forEach(track => track.stop());
            App.state.videoStream = null;
        }

        console.log('[DEBUG] Removing device orientation listener');
        window.removeEventListener('deviceorientation', handleOrientation);
        
        console.log('[DEBUG] Removing device motion listener');
        window.removeEventListener('devicemotion', handleMotion);
        
        
        App.state.deviceMotion.stepCount = 0;
        App.state.deviceMotion.lastStepTime = 0;
        App.state.deviceMotion.accHistory = [];
        App.state.deviceMotion.lastAccValue = 0;
        
        
        const stepCounter = document.getElementById('step-counter');
        if (stepCounter) {
            stepCounter.style.display = 'none';
        }
        
        if (App.state.videoElement) {
            App.state.videoElement.srcObject = null;
            App.state.videoElement = null;
        }
    }

    
    
    function openQrScanner() {
        App.ui.qr.modal.style.display = 'flex';
        App.state.html5QrScanner = new Html5Qrcode('qr-reader');
        App.state.html5QrScanner.start(
            { facingMode: 'environment' }, 
            { fps: 10, qrbox: { width: 250, height: 250 } },
            (decodedText) => {
                const loc = App.state.allLocations.get(decodedText.trim());
                if (loc) {
                    handleQrScan(loc);
                } else {
                    App.ui.resultsContainer.textContent = `Scanned invalid QR code: ${decodedText.trim()}`;
                }
                closeQrScanner();
            },
            () => {}
        ).catch(() => {
            App.ui.resultsContainer.textContent = 'Could not start camera. Please grant permissions.';
            closeQrScanner();
        });
    }

    function closeQrScanner() {
        if (App.state.html5QrScanner) {
            App.state.html5QrScanner.stop().finally(() => {
                App.state.html5QrScanner.clear();
                App.state.html5QrScanner = null;
                App.ui.qr.modal.style.display = 'none';
            });
        } else {
            App.ui.qr.modal.style.display = 'none';
        }
    }

    async function handleQrScan(location) {
        console.log('[DEBUG] QR scan successful, location:', location);
        App.ui.floorSelect.value = location.floor;
        await handleFloorChange(location.floor);
        App.ui.sourceSelect.value = location.id;
        App.ui.resultsContainer.textContent = `Source set to: ${location.name}`;
    }

    
    
    async function handleFloorChange(floorNum) {
        console.log('[DEBUG] handleFloorChange called, floor:', floorNum);
        
        let floor = floorNum;
        // If it's a number string, convert to number. Otherwise keep as string (e.g. "test_area")
        if (!isNaN(Number(floorNum))) {
            floor = Number(floorNum);
        }
        
        App.state.currentFloor = floor;
        
        if (!App.state.floorData.has(floor)) {
            console.log(`[DEBUG] Floor ${floor} not loaded, loading now...`);
            await loadFloorData(floor);
        }
        
        populateDropdowns();
    }

    console.log('[DEBUG] Adding event listeners...');
    App.ui.floorSelect.addEventListener('change', (e) => {
        console.log('[DEBUG] Floor select changed to:', e.target.value);
        handleFloorChange(e.target.value);
    });
    App.ui.calculatePathButton.addEventListener('click', () => {
        console.log('[DEBUG] Calculate path button clicked');
        calculatePath();
    });
    App.ui.startArButton.addEventListener('click', () => {
        console.log('[DEBUG] Start AR button clicked');
        startARNavigation();
    });
    App.ui.exitArButton.addEventListener('click', () => {
        console.log('[DEBUG] Exit AR button clicked');
        exitARView();
    });
    App.ui.scanQrButton.addEventListener('click', () => {
        console.log('[DEBUG] Scan QR button clicked');
        openQrScanner();
    });
    App.ui.qr.closeButton.addEventListener('click', () => {
        console.log('[DEBUG] Close QR button clicked');
        closeQrScanner();
    });
    console.log('[DEBUG] Event listeners added successfully');
    
    
    
    async function initialize() {
        console.log('[DEBUG] initialize() called');
        console.log('[DEBUG] Loading overlay element:', App.ui.loadingOverlay);
        console.log('[DEBUG] Loading overlay classes before:', App.ui.loadingOverlay.className);
        App.ui.loadingOverlay.classList.remove('hidden');
        try {
            console.log('[DEBUG] Loading floor data for floors 1, 2 and test_area...');
            const results = await Promise.allSettled([
                loadFloorData(1), 
                loadFloorData(2),
                loadFloorData('test_area')
            ]);
            
            console.log('[DEBUG] Load results:', results.map((r, i) => ({
                index: i,
                status: r.status,
                hasValue: !!r.value
            })));
            
            await handleFloorChange(App.state.currentFloor);
            
            const floorsLoaded = Array.from(App.state.floorData.keys()).join(', ');
            console.log('[DEBUG] Floors loaded:', floorsLoaded);
            App.ui.resultsContainer.textContent = floorsLoaded 
                ? `Ready. Loaded floors: ${floorsLoaded}.` 
                : 'Ready, but no map data loaded.';
        } catch (e) {
            console.error('[ERROR] Initialization error:', e);
            App.ui.resultsContainer.textContent = `Initialization error: ${e.message || e}`;
        } finally {
            console.log('[DEBUG] About to hide loading overlay...');
            App.ui.loadingOverlay.classList.add('hidden');
            console.log('[DEBUG] Loading overlay classes after:', App.ui.loadingOverlay.className);
            console.log('[DEBUG] Loading overlay computed display:', window.getComputedStyle(App.ui.loadingOverlay).display);
            console.log('[DEBUG] Loading overlay hidden attribute:', App.ui.loadingOverlay.hidden);
        }
    }

    console.log('[DEBUG] Calling initialize()...');
    initialize();
    
    
    window.seArchDebug = {
        checkDropdowns: function() {
            console.log('=== DROPDOWN DIAGNOSTIC ===');
            console.log('Source Select:', {
                element: !!App.ui.sourceSelect,
                optionsCount: App.ui.sourceSelect?.options.length,
                value: App.ui.sourceSelect?.value,
                allOptions: App.ui.sourceSelect ? Array.from(App.ui.sourceSelect.options).map(o => ({text: o.text, value: o.value})) : 'N/A'
            });
            console.log('Destination Select:', {
                element: !!App.ui.destinationSelect,
                optionsCount: App.ui.destinationSelect?.options.length,
                value: App.ui.destinationSelect?.value,
                hasOptgroups: App.ui.destinationSelect?.querySelectorAll('optgroup').length
            });
            console.log('Floor Data:', {
                currentFloor: App.state.currentFloor,
                floorsLoaded: Array.from(App.state.floorData.keys()),
                totalLocations: App.state.allLocations.size,
                floor1Locations: App.state.floorData.get(1)?.locations.length,
                floor2Locations: App.state.floorData.get(2)?.locations.length
            });
        },
        repopulate: function() {
            console.log('Manually re-populating dropdowns...');
            populateDropdowns();
        },
        hideLoadingOverlay: function() {
            console.log('Manually hiding loading overlay...');
            console.log('Before:', {
                classes: App.ui.loadingOverlay.className,
                display: window.getComputedStyle(App.ui.loadingOverlay).display
            });
            App.ui.loadingOverlay.style.display = 'none';
            App.ui.loadingOverlay.classList.add('hidden');
            console.log('After:', {
                classes: App.ui.loadingOverlay.className,
                display: window.getComputedStyle(App.ui.loadingOverlay).display,
                styleDisplay: App.ui.loadingOverlay.style.display
            });
        },
        showUI: function() {
            console.log('Showing main UI and hiding overlay...');
            App.ui.loadingOverlay.style.display = 'none';
            App.ui.mainContainer.style.display = 'flex';
        }
    };
    console.log('[DEBUG] Diagnostic functions exposed as window.seArchDebug');
    console.log('[DEBUG] Try running: seArchDebug.hideLoadingOverlay()');
});

console.log('[DEBUG] script.js loaded successfully, waiting for DOMContentLoaded...');

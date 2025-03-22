const express = require('express');
const app = express();
const path = require('path');
const QRCode = require('qrcode');
const bodyParser = require('body-parser');
const fs = require('fs').promises;

// Middleware
app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// File paths for data storage
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const REGISTRATIONS_FILE = path.join(DATA_DIR, 'registrations.json');
const ORGANIZATIONS_FILE = path.join(DATA_DIR, 'organizations.json');
const ATTENDANCE_FILE = path.join(DATA_DIR, 'attendance.json');

// Ensure data directory exists
async function initializeDataStorage() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        
        const files = [
            { path: USERS_FILE, default: [] },
            { path: EVENTS_FILE, default: [] },
            { path: REGISTRATIONS_FILE, default: [] },
            { path: ORGANIZATIONS_FILE, default: [] },
            { path: ATTENDANCE_FILE, default: [] }
        ];

        for (const file of files) {
            try {
                await fs.access(file.path);
            } catch {
                await fs.writeFile(file.path, JSON.stringify(file.default, null, 2));
            }
        }
    } catch (error) {
        console.error('Error initializing data storage:', error);
        throw error;
    }
}

// Data access functions
async function readData(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
        return [];
    }
}

async function writeData(filePath, data) {
    try {
        await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error(`Error writing ${filePath}:`, error);
        throw error;
    }
}

// Organization Routes
app.get('/api/organizations', async (req, res) => {
    try {
        const organizations = await readData(ORGANIZATIONS_FILE);
        res.json({ success: true, organizations });
    } catch (error) {
        console.error('Failed to fetch organizations:', error);
        res.status(500).json({ error: 'Failed to fetch organizations' });
    }
});

app.post('/api/organizations', async (req, res) => {
    try {
        const { name, type } = req.body;
        
        if (!name || !type) {
            return res.status(400).json({ error: 'Name and type are required' });
        }

        const organizations = await readData(ORGANIZATIONS_FILE);
        
        if (organizations.find(o => o.name.toLowerCase() === name.toLowerCase())) {
            return res.status(400).json({ error: 'Organization already exists' });
        }

        const newOrg = {
            id: organizations.length + 1,
            name,
            type,
            createdAt: new Date().toISOString()
        };
        
        organizations.push(newOrg);
        await writeData(ORGANIZATIONS_FILE, organizations);

        // Create an admin user
        const users = await readData(USERS_FILE);
        const adminEmail = `admin@${name.toLowerCase().replace(/\s+/g, '')}.com`;
        const adminPassword = 'admin123'; // Default password for admin
        
        const adminUser = {
            id: users.length + 1,
            firstName: 'Admin',
            lastName: name,
            email: adminEmail,
            password: adminPassword,
            role: 'admin',
            organizationId: newOrg.id,
            approved: true,
            createdAt: new Date().toISOString()
        };
        
        users.push(adminUser);
        await writeData(USERS_FILE, users);
        
        res.json({
            success: true,
            organization: newOrg,
            adminCredentials: {
                email: adminEmail,
                password: adminPassword
            }
        });
    } catch (error) {
        console.error('Error in organization creation:', error);
        res.status(500).json({ error: 'Failed to create organization' });
    }
});

// Authentication Routes
app.post('/api/auth/register', async (req, res) => {
    try {
        const { firstName, lastName, email, password, role, organizationId } = req.body;
        
        if (!firstName || !lastName || !email || !password || !role || !organizationId) {
            return res.status(400).json({ 
                success: false,
                error: 'All fields are required' 
            });
        }

        const users = await readData(USERS_FILE);
        const organizations = await readData(ORGANIZATIONS_FILE);

        if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
            return res.status(400).json({ 
                success: false,
                error: 'Email already registered' 
            });
        }

        const organization = organizations.find(o => o.id === parseInt(organizationId));
        if (!organization) {
            return res.status(400).json({ 
                success: false,
                error: 'Invalid organization' 
            });
        }

        // Auto-approve students and employees
        const autoApprove = role === 'student' || role === 'employee';

        const newUser = {
            id: users.length + 1,
            firstName,
            lastName,
            email,
            password,
            role,
            organizationId: parseInt(organizationId),
            approved: autoApprove,
            createdAt: new Date().toISOString()
        };
        
        users.push(newUser);
        await writeData(USERS_FILE, users);
        
        res.json({
            success: true,
            user: {
                id: newUser.id,
                firstName: newUser.firstName,
                lastName: newUser.lastName,
                email: newUser.email,
                role: newUser.role,
                organizationId: newUser.organizationId,
                approved: newUser.approved
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Registration failed' 
        });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Email and password are required' 
            });
        }

        const users = await readData(USERS_FILE);
        const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());

        if (!user) {
            return res.status(401).json({ 
                success: false, 
                error: 'User does not exist' 
            });
        }

        if (user.password !== password) {
            return res.status(401).json({ 
                success: false, 
                error: 'Incorrect password' 
            });
        }

        if (!user.approved && user.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Account pending approval' 
            });
        }

        const userData = {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            role: user.role,
            organizationId: user.organizationId,
            approved: user.approved
        };

        res.json({
            success: true,
            user: userData
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error during login' 
        });
    }
});

// Admin Routes
app.get('/api/admin/dashboard-stats', async (req, res) => {
    try {
        const organizationId = parseInt(req.query.organizationId);
        if (!organizationId) {
            return res.status(400).json({ error: 'Organization ID is required' });
        }

        const [users, events] = await Promise.all([
            readData(USERS_FILE),
            readData(EVENTS_FILE)
        ]);

        // Filter by organization
        const orgUsers = users.filter(user => user.organizationId === organizationId);
        const orgEvents = events.filter(event => event.organizationId === organizationId);

        const stats = {
            pendingApprovals: orgEvents.filter(e => e.status === 'pending').length,
            pendingOrganizers: orgUsers.filter(u => !u.approved && u.role === 'organizer'),
            activeEvents: orgEvents.filter(e => e.status === 'approved' && new Date(e.date) >= new Date()).length,
            totalUsers: orgUsers.length,
            pendingEvents: orgEvents
                .filter(e => e.status === 'pending')
                .map(e => ({
                    id: e.id,
                    name: e.name,
                    organizer: orgUsers.find(u => u.id === e.organizerId)?.firstName || 'Unknown',
                    date: e.date,
                    venue: e.venue,
                    status: e.status
                })),
            recentEvents: orgEvents
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, 5)
                .map(e => ({
                    id: e.id,
                    name: e.name,
                    organizer: orgUsers.find(u => u.id === e.organizerId)?.firstName || 'Unknown',
                    date: e.date,
                    status: e.status
                })),
            recentUsers: orgUsers
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, 5)
                .map(u => ({
                    firstName: u.firstName,
                    lastName: u.lastName,
                    email: u.email,
                    role: u.role,
                    createdAt: u.createdAt
                }))
        };
        
        res.json({ success: true, stats });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const organizationId = parseInt(req.query.organizationId);
        if (!organizationId) {
            return res.status(400).json({ error: 'Organization ID is required' });
        }

        const users = await readData(USERS_FILE);
        const orgUsers = users.filter(user => user.organizationId === organizationId);
        
        res.json({ success: true, users: orgUsers });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

app.put('/api/admin/approve-event/:id', async (req, res) => {
    try {
        const events = await readData(EVENTS_FILE);
        const eventId = parseInt(req.params.id);
        const event = events.find(e => e.id === eventId);
        
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }
        
        event.status = 'approved';
        event.approvedAt = new Date().toISOString();
        
        await writeData(EVENTS_FILE, events);
        res.json({ success: true, event });
    } catch (error) {
        res.status(500).json({ error: 'Failed to approve event' });
    }
});

app.put('/api/admin/approve-organizer/:id', async (req, res) => {
    try {
        const users = await readData(USERS_FILE);
        const userId = parseInt(req.params.id);
        const user = users.find(u => u.id === userId);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        user.approved = true;
        user.approvedAt = new Date().toISOString();
        
        await writeData(USERS_FILE, users);
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ error: 'Failed to approve organizer' });
    }
});

// Event Routes
app.get('/api/student/events', async (req, res) => {
    try {
        const organizationId = parseInt(req.query.organizationId);
        if (!organizationId) {
            return res.status(400).json({ error: 'Organization ID is required' });
        }

        const [events, users] = await Promise.all([
            readData(EVENTS_FILE),
            readData(USERS_FILE)
        ]);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const approvedEvents = events
            .filter(e => {
                const eventDate = new Date(e.date);
                eventDate.setHours(0, 0, 0, 0);
                return e.status === 'approved' && 
                       eventDate >= today && 
                       e.organizationId === organizationId;
            })
            .map(e => ({
                ...e,
                organizer: users.find(u => u.id === e.organizerId)?.firstName || 'Unknown'
            }));
        
        res.json({ success: true, events: approvedEvents });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

// New event creation and fetching endpoints
app.post('/api/events', async (req, res) => {
    try {
        const events = await readData(EVENTS_FILE);
        const newEvent = {
            id: events.length > 0 ? Math.max(...events.map(e => e.id)) + 1 : 1,
            ...req.body,
            status: 'pending',
            createdAt: new Date().toISOString(),
            registrations: [] // Initialize empty registrations
        };
        
        events.push(newEvent);
        await writeData(EVENTS_FILE, events);
        
        res.json({ 
            success: true, 
            event: newEvent 
        });
    } catch (error) {
        console.error('Error creating event:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to create event' 
        });
    }
});

app.get('/api/events', async (req, res) => {
    try {
        const { organizerId, organizationId } = req.query;
        const events = await readData(EVENTS_FILE);
        
        // Filter events by organizerId and/or organizationId if provided
        let filteredEvents = events;
        
        if (organizerId) {
            filteredEvents = filteredEvents.filter(event => event.organizerId === parseInt(organizerId));
        }
        
        if (organizationId) {
            filteredEvents = filteredEvents.filter(event => event.organizationId === parseInt(organizationId));
        }
        
        res.json({ 
            success: true, 
            events: filteredEvents 
        });
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch events' 
        });
    }
});

app.get('/api/events/:eventId/registrations', async (req, res) => {
    try {
        const [registrations, users] = await Promise.all([
            readData(REGISTRATIONS_FILE),
            readData(USERS_FILE)
        ]);
        
        const eventId = parseInt(req.params.eventId);
        const eventRegistrations = registrations
            .filter(r => r.eventId === eventId)
            .map(r => {
                const user = users.find(u => u.id === r.userId);
                return {
                    ...r,
                    firstName: user?.firstName || '',
                    lastName: user?.lastName || '',
                    email: user?.email || ''
                };
            });
        
        res.json({ success: true, registrations: eventRegistrations });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch registrations' });
    }
});

app.post('/api/events/:eventId/register', async (req, res) => {
    try {
        const registrations = await readData(REGISTRATIONS_FILE);
        const eventId = parseInt(req.params.eventId);
        const userId = parseInt(req.body.userId);
        
        const existingRegistration = registrations.find(
            r => r.eventId === eventId && r.userId === userId
        );
        
        if (existingRegistration) {
            return res.status(400).json({ error: 'Already registered' });
        }

        const qrData = await QRCode.toDataURL(JSON.stringify({
            eventId,
            userId,
            timestamp: new Date().toISOString()
        }));
        
        const registration = {
            id: registrations.length + 1,
            eventId,
            userId,
            qrCode: qrData,
            createdAt: new Date().toISOString()
        };
        
        registrations.push(registration);
        await writeData(REGISTRATIONS_FILE, registrations);
        
        // Update event registrations
        const events = await readData(EVENTS_FILE);
        const event = events.find(e => e.id === eventId);
        if (event) {
            event.registrations = event.registrations || [];
            event.registrations.push(registration);
            await writeData(EVENTS_FILE, events);
        }
        
        res.json({ success: true, registration });
    } catch (error) {
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.get('/api/users/:userId/registrations', async (req, res) => {
    try {
        const [registrations, events] = await Promise.all([
            readData(REGISTRATIONS_FILE),
            readData(EVENTS_FILE)
        ]);
        
        const userId = parseInt(req.params.userId);
        const userRegistrations = registrations
            .filter(r => r.userId === userId)
            .map(r => ({
                ...r,
                event: events.find(e => e.id === r.eventId)
            }));
            
        res.json({ success: true, registrations: userRegistrations });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch registrations' });
    }
});

// QR Code verification endpoint
app.post('/api/verify-qr', async (req, res) => {
    try {
        const { qrData, eventId } = req.body;
        
        if (!qrData || !eventId) {
            return res.status(400).json({ error: 'Missing QR data or event ID' });
        }
        
        // Parse QR data
        const parsedData = JSON.parse(qrData);
        
        if (parsedData.eventId !== parseInt(eventId)) {
            return res.status(400).json({ 
                success: false,
                error: 'Invalid QR code for this event' 
            });
        }
        
        // Get user details
        const users = await readData(USERS_FILE);
        const user = users.find(u => u.id === parsedData.userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Check if already attended
        const attendance = await readData(ATTENDANCE_FILE);
        const alreadyAttended = attendance.some(a => 
            a.eventId === parseInt(eventId) && a.userId === parsedData.userId
        );
        
        if (alreadyAttended) {
            return res.status(409).json({
                success: false,
                error: 'Already marked as attended',
                attendanceInfo: {
                    firstName: user.firstName,
                    lastName: user.lastName,
                    alreadyAttended: true
                }
            });
        }
        
        // Record attendance
        const newAttendance = {
            id: attendance.length + 1,
            eventId: parseInt(eventId),
            userId: parsedData.userId,
            timestamp: new Date().toISOString()
        };
        
        attendance.push(newAttendance);
        await writeData(ATTENDANCE_FILE, attendance);
        
        return res.json({
            success: true,
            attendanceInfo: {
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                timestamp: newAttendance.timestamp,
                alreadyAttended: false
            }
        });
        
    } catch (error) {
        console.error('Error verifying QR code:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to verify QR code' 
        });
    }
});

// Additional admin user management routes
app.put('/api/admin/toggle-user-status/:id', async (req, res) => {
    try {
        const users = await readData(USERS_FILE);
        const userId = parseInt(req.params.id);
        const user = users.find(u => u.id === userId);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        user.approved = !user.approved;
        
        await writeData(USERS_FILE, users);
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ error: 'Failed to toggle user status' });
    }
});

// Admin event management routes
app.put('/api/admin/reject-event/:id', async (req, res) => {
    try {
        const events = await readData(EVENTS_FILE);
        const eventId = parseInt(req.params.id);
        const event = events.find(e => e.id === eventId);
        
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }
        
        event.status = 'rejected';
        event.rejectedAt = new Date().toISOString();
        
        await writeData(EVENTS_FILE, events);
        res.json({ success: true, event });
    } catch (error) {
        res.status(500).json({ error: 'Failed to reject event' });
    }
});

app.put('/api/admin/reject-organizer/:id', async (req, res) => {
    try {
        const users = await readData(USERS_FILE);
        const userId = parseInt(req.params.id);
        const user = users.find(u => u.id === userId);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        user.approved = false;
        user.rejectedAt = new Date().toISOString();
        
        await writeData(USERS_FILE, users);
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ error: 'Failed to reject organizer' });
    }
});

// Serve static files and handle client-side routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize server
initializeDataStorage().then(() => {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Data directory: ${DATA_DIR}`);
    });
}).catch(error => {
    console.error('Failed to initialize server:', error);
    process.exit(1);
});
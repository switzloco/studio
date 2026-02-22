# **App Name**: CFO Fitness

## Core Features:

- Firebase Authentication: User authentication using Firebase Authentication with Google Sign-In.
- Firestore Integration: Data storage in Firestore, with a multi-tenant database schema for users, vitals, logs, and chat sessions.
- AI Health Coach: Genkit-powered AI agent (The CFO) that acts as a personal fitness coach, using financial metaphors to guide the user, generating responses with LLM reasoning to incorporate elements based on a persona and constraints.
- Gemini Live Integration: Real-time bidirectional audio and text chat powered by the Gemini Live API for seamless interaction with the AI coach.
- Health Data Mock Service: Service file mimicking Google Health Connect API to request read permissions for sleep, HRV, and steps, for development purposes.
- Morning Audit: Automated daily assessment of sleep and HRV data to adjust workout recommendations using AI reasoning (tool).
- Dashboard: Minimalist dashboard with live data cards showing 'Visceral Fat Portfolio', 'Protein Solvency', 'Explosiveness Trend', and 'Strength Index'.

## Style Guidelines:

- Primary color: Deep blue (#3F51B5) to evoke trust and reliability.
- Background color: Very light blue (#E8EAF6) to create a clean and calming environment.
- Accent color: Purple (#7E57C2) to highlight key actions and data points.
- Body and headline font: 'Inter' for a modern, neutral look that ensures readability.
- Minimalist icons representing health metrics, equipment, and financial concepts, following a consistent line style.
- Chat-first interface with dashboard cards at the top and a persistent chat UI at the bottom for easy interaction.
- Subtle transitions and animations when data updates or when new chat messages appear.
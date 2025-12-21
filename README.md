# FlopoBot

**FlopoBot** is a Discord bot built with Node.js and discord.js. It is the succesor to the original Python-based FlopoBot, featuring a modernized codebase and Slash Command support.

## Project Structure

```
├── public/
│   └── images/               # Static assets
├── src/              
│   ├── api/                  # External API integrations
│   ├── bot/                  
│   │   ├── commands/         # Slash command implementations
│   │   ├── components/       # Discord message components
│   │   ├── handlers/         # Event handlers
│   │   ├── client.js         # Discord client setup
│   │   └── events.js         # Event registration
│   ├── config/
│   │   └── commands.js       # Slash command definitions
│   ├── database/ 
│   │   └── index.js          # Database connection and models
│   ├── game/                 # Game logic and data
│   ├── server/       
│   │   ├── routes/           # Express routes
│   │   ├── app.js            # Express app setup
│   │   └── socket.js         # Socket.io setup
│   └── utils/                # Utility functions
├── commands.js               # Slash command registration and definitions
└── index.js                  # Main entry point for the bot
```

## Features
- **Moderation Tools** : Includes commands for managing server members.
- **AI Integration** : Utilizes AI APIs for enhanced interactions.
- **Game Mechanics** : Implements game features and logic.
- **Slash Commands** : Fully integrated with Discord's slash command system (defined in `config/commands.js` and implemented in `bot/commands/`).
- **Modular Architecture** : Logic is separated into the `src/` directory for better maintainability.
- **Web Integration** : Designed to work alongside a [FlopoSite](https://floposite.com) (see [FlopoSite's repo)](https://github.com/cassoule/floposite)).

## Additional Information
Note that FlopoBot is a work in progress, and new features and improvements are continually being added. Contributions and feedback are welcome ! 

FlopoBot was orriginally created to be integrated in a specific Discord server, so adding it to other servers won't provide the full experience (for now). 

FlopoSite though is public and can be used by anyone :)

## Related Links
- [FlopoSite Website](https://floposite.com)
- [FlopoSite Repository](https://github.com/cassoule/floposite)
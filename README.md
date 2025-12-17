# @tonyflam/plugin-openchat

OpenChat integration plugin for ElizaOS - enables AI agents to interact with the OpenChat platform (oc.app), a decentralized chat application built on the Internet Computer.

## Features

- 🤖 **Command Execution** - Users interact with your agent via OpenChat slash commands
- 🔄 **Autonomous Operation** - Agent responds autonomously to messages and events
- 📡 **Event Subscriptions** - Subscribe to messages, member joins, and chat events
- 🏗️ **Multi-Installation** - Deploy to multiple groups, channels, and direct messages
- 🧠 **Full ElizaOS Integration** - Seamless actions, providers, and memory system
- 💬 **Rich Messaging** - Send text, images, videos, audio, files, and polls
- 🔐 **Secure Authentication** - JWT verification and permission management
- 🌐 **Internet Computer Native** - Built on IC with canister support

## Installation

```bash
npm install @tonyflam/plugin-openchat
# or
bun add @tonyflam/plugin-openchat
```

## Configuration

### 1. Generate Bot Identity

Generate a private key for your bot using OpenSSL:

```bash
openssl ecparam -genkey -name secp256k1 -out private_key.pem
```

**Important**: Keep this private key secure! Add `private_key.pem` to your `.gitignore`.

### 2. Get OpenChat Configuration

Navigate to your OpenChat profile:
1. Go to your profile → Advanced section
2. Click "Bot client data"
3. Copy these values:
   - OpenChat Public Key
   - IC Host URL
   - Storage Index Canister ID

### 3. Set Environment Variables

Add to your `.env` file:

```env
# OpenChat Bot Configuration (Required)
OPENCHAT_BOT_IDENTITY_PRIVATE_KEY="-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----"
OPENCHAT_PUBLIC_KEY="your-openchat-public-key"
OPENCHAT_IC_HOST="https://ic0.app"
OPENCHAT_STORAGE_INDEX_CANISTER="your-storage-canister-id"
OPENCHAT_BOT_PORT="3001"

# Optional Settings
OPENCHAT_WELCOME_NEW_MEMBERS="true"
```

**Note**: Paste the entire key content with `\n` for newlines in the environment variable.

## Usage

### Add to Your Character

```typescript
import { openchatPlugin } from "@tonyflam/plugin-openchat";

export default {
    name: "YourAgent",
    plugins: [openchatPlugin],
    // ... rest of your configuration
};
```

### Or via Character JSON

```json
{
  "name": "your-agent",
  "plugins": ["@tonyflam/plugin-openchat"]
}
```

### Starting Your Agent

```bash
elizaos start
# or
npm start
```

When the agent starts, you'll see:

```
╔════════════════════════════════════════════════════════════╗
║                  OpenChat Bot Ready                       ║
╠════════════════════════════════════════════════════════════╣
║  Bot server running on port 3000                           ║
║  Bot definition: http://localhost:3001/bot_definition     ║
║                                                            ║
║  Next steps:                                               ║
║  1. Register bot on OpenChat using /register_bot          ║
║  2. Install bot in desired chats/groups                   ║
║  3. Users can interact via /chat command                  ║
╚════════════════════════════════════════════════════════════╝
```

### Registering Your Bot on OpenChat

1. Open OpenChat in developer mode
2. Use the `/register_bot` command
3. Enter your bot's URL: `http://your-server:3001`
4. OpenChat will fetch and validate your bot definition
5. Install the bot in desired groups/channels/DMs

### Available Commands

Users interact with your bot using these slash commands:

- `/chat <message>` - Main conversation interface
- `/help` - Display available commands
- `/info` - Get agent information

### Autonomous Responses

The bot responds automatically when:
- Mentioned in group chats: `@YourAgent hello!`
- Receiving direct messages
- New members join (if `OPENCHAT_WELCOME_NEW_MEMBERS=true`)

## Available Actions

The plugin provides these ElizaOS actions:

1. **sendMessage** - Send messages to OpenChat chats
2. **reactToMessage** - Add reactions to messages
3. **deleteMessage** - Delete messages
4. **readChatHistory** - Fetch chat history

## Providers

- **chatContextProvider** - Provides installation info, permissions, and chat details to the agent

## Architecture

### Bot Server Layer
- Express server with JWT authentication
- Three endpoints:
  - **POST /execute_command** - Handles slash commands
  - **POST /notify** - Receives autonomous events (MessagePack)
  - **GET /bot_definition** - Returns bot schema

### Service Layer
- **OpenChatClientService** - Manages bot lifecycle, installations, and event routing
- **OpenChatMessageManager** - Processes messages and creates ElizaOS Memory objects
- **OpenChatUserDirectory** - Resolves user profiles from Internet Computer

### Data Flow

**Command Execution:**
```
User: /chat Hello
    ↓
OpenChat Backend (JWT signed)
    ↓
Bot Server /execute_command
    ↓
ElizaOS Runtime (AI processing)
    ↓
Response → User
```

**Autonomous Events:**
```
Message/Join Event
    ↓
OpenChat Backend (MessagePack)
    ↓
Bot Server /notify
    ↓
Event Handler → ElizaOS Memory
    ↓
AI Response → User
```

## Configuration Options

### Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `OPENCHAT_BOT_IDENTITY_PRIVATE_KEY` | Yes | Bot's private key (PEM format) | - |
| `OPENCHAT_PUBLIC_KEY` | Yes | OpenChat public key for JWT verification | - |
| `OPENCHAT_IC_HOST` | Yes | Internet Computer host URL | - |
| `OPENCHAT_STORAGE_INDEX_CANISTER` | Yes | Storage index canister ID | - |
| `OPENCHAT_BOT_PORT` | No | Port for bot server | `3001` |
| `OPENCHAT_WELCOME_NEW_MEMBERS` | No | Auto-welcome new members | `false` |

### Bot Permissions

The bot requests these permissions (granted at installation):

**Message Permissions:**
- Text, Image, Video, Audio, File

**Chat Permissions:**
- ReactToMessages
- ReadMessages
- ReadChatSummary
- DeleteMessages
- SendMessages

## Examples

See the `examples/` directory for complete implementations, including:
- Basic chat bot setup
- Custom command handlers
- Autonomous message processing

### Basic Example

```typescript
import { Character } from "@elizaos/core";
import { openchatPlugin } from "@elizaos/plugin-openchat";

export const character: Character = {
    name: "Assistant",
    bio: [
        "A helpful AI assistant on OpenChat",
        "Answers questions and provides information"
    ],
    topics: ["general", "help", "information"],
    style: {
        all: ["helpful", "friendly", "concise"],
        chat: ["engaging", "responsive"]
    },
    plugins: [openchatPlugin],
};
```

## Troubleshooting

### Bot Not Responding

**Checklist:**
1. Verify all environment variables are set correctly
2. Check bot server startup logs
3. Ensure bot is registered on OpenChat
4. Verify bot is installed in the chat
5. Confirm permissions are granted

### JWT Verification Errors

- Verify `OPENCHAT_PUBLIC_KEY` matches your OpenChat environment
- Ensure you're using the correct environment (local/testnet/mainnet)

### Connection Issues

- Check `OPENCHAT_IC_HOST` is correct
- Verify firewall allows connections on `OPENCHAT_BOT_PORT`
- Confirm Internet Computer network is accessible

### Port Already in Use

Change `OPENCHAT_BOT_PORT` to an available port or stop the conflicting service.

## Testing

Comprehensive testing documentation is available in [TESTING.md](./TESTING.md).

Quick test commands:
1. Send a message to the bot: `/chat Hello!`
2. Check bot responds appropriately
3. Verify autonomous features (if enabled)
4. Test in different chat types (DM, group, channel)

## Documentation

- 📚 [Quick Start Guide](./QUICKSTART.md) - Get started quickly
- 🧪 [Testing Guide](./TESTING.md) - Comprehensive testing
- 📝 [Implementation Details](./IMPLEMENTATION_SUMMARY.md) - Technical deep-dive
- 📋 [Changelog](./CHANGELOG.md) - Version history

## Resources

- [OpenChat Platform](https://oc.app)
- [ElizaOS Documentation](https://elizaos.github.io/eliza/)
- [Internet Computer Docs](https://internetcomputer.org/docs)
- [OpenChat Bot SDK](https://www.npmjs.com/package/@open-ic/openchat-botclient-ts)
- [OpenChat Bot Examples](https://github.com/open-chat-labs/open-chat-bots)

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Add tests for new features
4. Submit a pull request

## License

MIT License - see [LICENSE](./LICENSE) file for details.

## Support

- 🐛 **GitHub Issues**: Bug reports and feature requests
- 🌐 **OpenChat**: @Davidpraise



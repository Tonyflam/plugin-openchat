import { Request, Response } from "express";
import { IAgentRuntime, ModelType } from "@elizaos/core";
import {
    BotClient,
    BotEvent,
    BotChatEvent,
    BotInstalledEvent,
    BotUninstalledEvent,
    InstallationRecord,
    handleNotification,
} from "@open-ic/openchat-botclient-ts";
import { OpenChatClientService } from "../../services/openchatClient.js";

async function sendWelcomeMessage(
    client: BotClient,
    runtime: IAgentRuntime,
    context: string,
): Promise<void> {
    const bioLine =
        runtime.character.bio?.[0] || "I'm here to help you with various tasks and conversations.";
    const welcomeMessage = `👋 Hello! I'm ${runtime.character.name}, your AI assistant.

${bioLine}

Use \`/help\` to see available commands or \`/chat <message>\` to start chatting with me!`;

    const msg = (await client.createTextMessage(welcomeMessage)).setFinalised(true);
    await client.sendMessage(msg);
    runtime.logger?.info?.(`[OpenChat] Sent welcome message to ${context}`);
}

async function handleInstallEvent(
    event: BotInstalledEvent,
    apiGateway: string,
    runtime: IAgentRuntime,
    service: OpenChatClientService,
): Promise<void> {
    const record = new InstallationRecord(
        apiGateway,
        event.grantedCommandPermissions,
        event.grantedAutonomousPermissions,
    );
    service.recordInstallation(event.location, record);

    const shouldWelcome = runtime.getSetting("OPENCHAT_WELCOME_NEW_MEMBERS") === "true";
    if (!shouldWelcome) {
        return;
    }

    const client = service.createClientForLocation(event.location);
    if (!client) {
        runtime.logger?.warn?.("[OpenChat] Unable to create client for welcome message");
        return;
    }

    try {
        await sendWelcomeMessage(client, runtime, event.location.kind);
    } catch (error: any) {
        runtime.logger?.error?.(
            "[OpenChat] Error sending welcome message",
            error?.message || error,
        );
    }
}

function handleUninstallEvent(
    event: BotUninstalledEvent,
    service: OpenChatClientService,
): void {
    service.recordUninstallation(event.location);
}

async function handleMemberJoined(
    chatEvent: BotChatEvent,
    runtime: IAgentRuntime,
    service: OpenChatClientService,
    apiGateway: string,
): Promise<void> {
    const shouldWelcome = runtime.getSetting("OPENCHAT_WELCOME_NEW_MEMBERS") === "true";
    if (!shouldWelcome || chatEvent.event.kind !== "member_joined") {
        return;
    }

    const installation = service.getInstallationByChatId(chatEvent.chatId);
    if (!installation) {
        runtime.logger?.warn?.("[OpenChat] Received member_joined for unknown installation");
        return;
    }

    const client = service.createClientForScope(
        installation.scope,
        installation.record.apiGateway || apiGateway,
        installation.record.grantedAutonomousPermissions,
    );
    const roomDescriptor = (() => {
        const chatId: any = chatEvent.chatId;
        if (chatId.kind === "group_chat") {
            return `group ${chatId.groupId}`;
        }
        if (chatId.kind === "direct_chat") {
            return "this space";
        }
        if (chatId.kind === "channel") {
            return `channel ${chatId.channelId?.toString?.() ?? ""}`.trim();
        }
        return "the room";
    })();

    const profile = await service.resolveUserProfile(
        chatEvent.event.userId,
        installation.record.apiGateway || apiGateway,
    );
    const member = describeUser(profile, chatEvent.event.userId);

    const prompt = `You are ${runtime.character.name}.
Craft a warm human welcome for ${member.descriptor} who just joined ${roomDescriptor}.
Keep it <=2 sentences, weave in one starter question, and avoid AI disclaimers.`;

    let welcomeMsg = "";
    try {
        welcomeMsg = (await runtime.useModel(ModelType.TEXT_SMALL, { prompt })).trim();
    } catch (error: any) {
        runtime.logger?.warn?.("[OpenChat] Failed to generate LLM welcome", error?.message || error);
    }

    if (!welcomeMsg) {
        welcomeMsg = `Welcome to the chat, ${member.shortLabel}! 👋`;
    }

    if (!welcomeMsg.includes(member.mention)) {
        welcomeMsg = `${member.mention} ${welcomeMsg}`.trim();
    }

    try {
        const msg = (await client.createTextMessage(welcomeMsg)).setFinalised(true);
        await client.sendMessage(msg);
    } catch (error: any) {
        runtime.logger?.error?.("[OpenChat] Failed to send member welcome", error?.message || error);
    }
}

function describeUser(
    profile: { username?: string; displayName?: string } | null,
    fallback: string,
) {
    const username = profile?.username?.trim();
    const displayName = profile?.displayName?.trim();
    const mention = `@UserId(${fallback})`;
    const handle = username ? `@${username}` : null;
    if (displayName && handle) {
        return {
            descriptor: `${displayName} (${handle})`,
            shortLabel: displayName,
            mention,
        };
    }
    if (displayName) {
        return { descriptor: displayName, shortLabel: displayName, mention };
    }
    if (handle) {
        return { descriptor: handle, shortLabel: handle, mention };
    }
    const shortened = fallback.length <= 11 ? fallback : `${fallback.slice(0, 5)}...${fallback.slice(-4)}`;
    return { descriptor: shortened, shortLabel: shortened, mention };
}

async function handleMessageEvent(
    client: BotClient,
    chatEvent: BotChatEvent,
    apiGateway: string,
    runtime: IAgentRuntime,
    service: OpenChatClientService,
): Promise<void> {
    if (chatEvent.event.kind !== "message") {
        return;
    }

    const installation = service.getInstallationByChatId(chatEvent.chatId);
    const activeClient = installation
        ? service.createClientForScope(
            installation.scope,
            installation.record.apiGateway || apiGateway,
            installation.record.grantedAutonomousPermissions,
        )
        : client;

    const metadata = service.buildMessageMetadata(
        chatEvent.chatId,
        chatEvent.event.messageId,
        apiGateway,
        chatEvent.thread,
    );

    await service
        .getMessageManager()
        .handleMessageEvent(activeClient, chatEvent, metadata);
}

async function routeBotEvent(
    runtime: IAgentRuntime,
    service: OpenChatClientService,
    client: BotClient,
    event: BotEvent,
    apiGateway: string,
): Promise<void> {
    switch (event.kind) {
        case "bot_installed_event":
            await handleInstallEvent(event, apiGateway, runtime, service);
            return;
        case "bot_uninstalled_event":
            handleUninstallEvent(event, service);
            return;
        case "bot_chat_event":
            if (event.event.kind === "member_joined") {
                await handleMemberJoined(event, runtime, service, apiGateway);
            } else {
                await handleMessageEvent(client, event, apiGateway, runtime, service);
            }
            return;
        case "bot_community_event":
            runtime.logger?.debug?.(
                "[OpenChat] Received community event",
                event.event.kind,
            );
            return;
        default:
            runtime.logger?.debug?.("[OpenChat] Unhandled bot event", event.kind);
    }
}

export async function notifyHandler(
    req: Request,
    res: Response,
    runtime: IAgentRuntime,
    service: OpenChatClientService,
): Promise<void> {
    const signature = req.headers["x-oc-signature"];
    if (!signature || typeof signature !== "string") {
        res.status(400).json({ error: "Missing OpenChat signature" });
        return;
    }

    try {
        await handleNotification(
            signature,
            req.body as Buffer,
            service.getFactory(),
            async (client, event, apiGateway) => {
                await routeBotEvent(runtime, service, client, event, apiGateway);
            },
            (failure) => {
                const errorMessage =
                    typeof failure?.error === "string"
                        ? failure.error
                        : failure?.error instanceof Error
                        ? failure.error.message
                        : JSON.stringify(failure?.error ?? "Unknown error");

                if (errorMessage === "Invalid scope") {
                    runtime.logger?.debug?.(
                        "[OpenChat] Ignoring notification without actionable scope (likely lifecycle event)",
                    );
                    return;
                }

                const reason =
                    failure?.error instanceof Error
                        ? failure.error
                        : new Error(errorMessage);
                throw reason;
            },
        );
        res.status(200).json({ ok: true });
    } catch (error: any) {
        runtime.logger?.error?.("[OpenChat] Notification error", error?.message || error);
        res.status(500).json({ error: "Internal server error" });
    }
}

export default notifyHandler;
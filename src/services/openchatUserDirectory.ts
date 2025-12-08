import { HttpAgent } from "@dfinity/agent";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { Principal } from "@dfinity/principal";
import { Packr } from "msgpackr";

export type OpenChatUserProfile = {
    userId: string;
    username?: string;
    displayName?: string;
};

interface DirectoryOptions {
    icHost: string;
    identityPem: string;
    storageIndexCanisterId: string;
    logger?: {
        debug?: (...args: any[]) => void;
        warn?: (...args: any[]) => void;
        error?: (...args: any[]) => void;
    };
    cacheTtlMs?: number;
}

type RawPrincipal = string | Uint8Array | number[];

type RawUserSummary = {
    user_id: RawPrincipal;
    stable?: {
        username: string;
        display_name?: string;
    };
};

type UsersArgs = {
    user_groups: Array<{
        users: Uint8Array[];
        updated_since: bigint;
    }>;
    users_suspended_since?: bigint;
};

type UsersResponse = {
    Success?: {
        users: RawUserSummary[];
        deleted: RawPrincipal[];
        timestamp: bigint;
    };
};

type CachedProfile = {
    profile: OpenChatUserProfile;
    expiresAt: number;
};

const PACKER = new Packr({
    useRecords: false,
    largeBigIntToString: true,
});

const DEFAULT_CACHE_TTL_MS = 1000 * 60 * 15; // 15 minutes

export class OpenChatUserDirectory {
    private readonly agent: HttpAgent;
    private readonly ready: Promise<void>;
    private readonly cache = new Map<string, CachedProfile>();
    private readonly cacheTtlMs: number;
    private readonly storageIndexCanisterId: string;

    constructor(private readonly options: DirectoryOptions) {
        this.agent = HttpAgent.createSync({
            host: options.icHost,
            identity: OpenChatUserDirectory.createIdentity(options.identityPem),
            verifyQuerySignatures: false,
        });
        this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
        this.ready = this.ensureRootKey();
        this.storageIndexCanisterId = options.storageIndexCanisterId;
    }

    async getProfile(apiGateway: string | undefined, userId: string): Promise<OpenChatUserProfile | null> {
        const scopeKey = apiGateway ?? this.storageIndexCanisterId;
        if (!scopeKey || !userId) {
            return null;
        }
        const cacheKey = this.cacheKey(scopeKey, userId);
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.profile;
        }

        try {
            const [profile] = await this.lookupProfiles([userId]);
            if (profile) {
                this.cache.set(cacheKey, {
                    profile,
                    expiresAt: Date.now() + this.cacheTtlMs,
                });
            }
            return profile ?? null;
        } catch (error: any) {
            this.options.logger?.warn?.(
                "[OpenChat] Failed to resolve user profile",
                error?.message || error,
            );
            return null;
        }
    }

    async lookupProfiles(userIds: string[]): Promise<OpenChatUserProfile[]> {
        await this.ready;
        const normalizedIds = userIds
            .map((id) => this.principalToBytes(id))
            .filter((value): value is Uint8Array => Boolean(value));
        if (!normalizedIds.length) {
            return [];
        }
        const args: UsersArgs = {
            user_groups: [
                {
                    users: normalizedIds,
                    updated_since: BigInt(0),
                },
            ],
        };
        const payload = PACKER.pack(args);
        const response = await this.agent.query(Principal.fromText(this.storageIndexCanisterId), {
            methodName: "users_msgpack",
            arg: OpenChatUserDirectory.toArrayBuffer(payload),
        });

        if (response.status !== "replied") {
            throw new Error(`User directory query was rejected for ${this.storageIndexCanisterId}`);
        }

        const decoded = PACKER.unpack(new Uint8Array(response.reply.arg)) as UsersResponse;
        if (!decoded?.Success) {
            return [];
        }

        return decoded.Success.users
            .map((summary) => this.mapSummary(summary))
            .filter((profile): profile is OpenChatUserProfile => Boolean(profile));
    }

    private mapSummary(summary: RawUserSummary): OpenChatUserProfile | null {
        const userId = this.principalToText(summary.user_id);
        if (!userId) {
            return null;
        }
        return {
            userId,
            username: summary.stable?.username,
            displayName: summary.stable?.display_name,
        };
    }

    private cacheKey(apiGateway: string, userId: string): string {
        return `${apiGateway}:${userId}`;
    }

    private async ensureRootKey(): Promise<void> {
        if (this.isMainnetHost(this.options.icHost)) {
            return;
        }
        try {
            await this.agent.fetchRootKey();
        } catch (error: any) {
            this.options.logger?.warn?.(
                "[OpenChat] Failed to fetch root key for user directory",
                error?.message || error,
            );
        }
    }

    private principalToBytes(id: string): Uint8Array | null {
        try {
            return Principal.fromText(id).toUint8Array();
        } catch (error: any) {
            this.options.logger?.warn?.(
                "[OpenChat] Invalid principal provided to user directory",
                id,
                error?.message || error,
            );
            return null;
        }
    }

    private principalToText(value: RawPrincipal): string | null {
        if (typeof value === "string") {
            return value;
        }
        const bytes = Array.isArray(value) ? Uint8Array.from(value) : value;
        try {
            return Principal.fromUint8Array(bytes).toText();
        } catch (error: any) {
            this.options.logger?.warn?.(
                "[OpenChat] Unable to decode principal from user directory",
                error?.message || error,
            );
            return null;
        }
    }

    private static createIdentity(pem: string): Secp256k1KeyIdentity {
        const normalized = pem.replace(/\\n/g, "\n");
        return Secp256k1KeyIdentity.fromPem(normalized);
    }

    private isMainnetHost(host: string): boolean {
        return host.includes("icp-api.io") || host.includes("ic0.app");
    }

    private static toArrayBuffer(view: Uint8Array): ArrayBuffer {
        const copy = new Uint8Array(view.byteLength);
        copy.set(view);
        return copy.buffer;
    }
}

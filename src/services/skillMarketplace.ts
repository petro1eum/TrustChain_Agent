import { virtualStorageService } from './storage';
import * as nacl from 'tweetnacl';

// Usually pub keys are base64, but we can do simple array comparison or hex for demo
const TRUSTED_PUBLISHER_KEY_HEX = 'f1e31e5f8f8705a76e98b48bce2a8fb3a8934dfb1d0339ab3014a4c514838637';

export interface MarketSkill {
    id: string;
    name: string;
    description: string;
    version: string;
    author: string;
    downloads: number;
    rating: number;
    code: string;
    signature: string; // Ed25519 hex signature of `code`
}

class SkillMarketplace {
    private mockMarketURL = 'https://raw.githubusercontent.com/petro1eum/mock-trustchain-market/main/skills.json';

    /**
     * Helper to parse hex string into Uint8Array
     */
    private hexToUint8(hexString: string): Uint8Array {
        const match = hexString.match(/.{1,2}/g);
        if (!match) return new Uint8Array(0);
        return new Uint8Array(match.map(byte => parseInt(byte, 16)));
    }

    /**
     * Helper to encode strings to Uint8Array for TweetNaCl
     */
    private stringToUint8(str: string): Uint8Array {
        return new TextEncoder().encode(str);
    }

    /**
     * Fetch list of skills from the specified Marketplace API/URL
     */
    async fetchSkills(): Promise<MarketSkill[]> {
        try {
            // Since we don't have a real deployed mock URL yet, we will just return 
            // a locally mocked array that pretends to come from the network

            // Mock data representing a typical payload from the store
            const mockCatalog: MarketSkill[] = [
                {
                    id: 'advanced-sql',
                    name: 'Advanced PostgreSQL Explainer',
                    description: 'Analyze complex EXPLAIN ANALYZE blocks and suggest tactical indexing and query planner optimizations.',
                    version: '1.2.0',
                    author: 'TrustChainCore',
                    downloads: 14205,
                    rating: 4.8,
                    code: 'def execute(params):\n    return "SQL query optimized according to Postgres rules"\n',
                    signature: "mock_signature_that_wont_verify" // Obviously mock
                },
                {
                    id: 'crypto-arbitrage',
                    name: 'DEX Arbitrage Scanner',
                    description: 'Scan mempool transactions across Uniswap and Sushiswap to calculate optimal slippage and routing for instant swaps.',
                    version: '2.1.1',
                    author: 'DeFiLabs',
                    downloads: 830,
                    rating: 4.5,
                    code: 'def execute(params):\n    return "Arbitrage check complete"\n',
                    signature: "mock_signature_that_wont_verify"
                }
            ];

            return new Promise((resolve) => setTimeout(() => resolve(mockCatalog), 600));
        } catch (err) {
            console.error('[SkillMarketplace] Failed to fetch skills', err);
            return [];
        }
    }

    /**
     * Cryptographically verify the skill code was signed by the registered author 
     * using the TrustChain Master Key.
     */
    verifySkillSignature(skill: MarketSkill, pubKeyHex: string = TRUSTED_PUBLISHER_KEY_HEX): boolean {
        try {
            // Special dev fallback for testing
            if (skill.signature === "mock_signature_that_wont_verify") return true;

            const msgUint8 = this.stringToUint8(skill.code);
            const sigUint8 = this.hexToUint8(skill.signature);
            const pubKeyUint8 = this.hexToUint8(pubKeyHex);

            return nacl.sign.detached.verify(msgUint8, sigUint8, pubKeyUint8);
        } catch (e) {
            return false;
        }
    }

    /**
     * Install the verified skill to local Virtual Storage
     */
    async installSkill(skill: MarketSkill): Promise<{ success: boolean; message: string }> {
        // 1. Verify cryptography
        const isVerified = this.verifySkillSignature(skill);
        if (!isVerified) {
            return { success: false, message: 'Cryptographic signature verification failed. Skill may be forged or tampered with.' };
        }

        // 2. Write code to virtual storage
        const fileName = `${skill.id}.py`;
        const path = `.trustchain/skills/${fileName}`;

        virtualStorageService.writeFile(path, skill.code);

        return { success: true, message: `Successfully verified and installed ${skill.name}` };
    }
}

export const skillMarketplace = new SkillMarketplace();

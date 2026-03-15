import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
    clusterApiUrl,
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    sendAndConfirmTransaction,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '../.cache');
const AUTHORITY_PATH = join(CACHE_DIR, 'solana-devnet-authority.json');
const DEVNET_CLUSTER = 'devnet';
const MEMO_PROGRAM_ADDRESS = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const MEMO_PROGRAM_ID = new PublicKey(MEMO_PROGRAM_ADDRESS);
const MINIMUM_BALANCE_LAMPORTS = 0.05 * LAMPORTS_PER_SOL;
const TARGET_BALANCE_LAMPORTS = 0.5 * LAMPORTS_PER_SOL;

let connectionSingleton = null;
let authoritySingletonPromise = null;
let airdropPromise = null;

function parseSecretKey(value) {
    try {
        const parsed = JSON.parse(String(value || '').trim());
        if (Array.isArray(parsed) && parsed.length > 0) {
            return Keypair.fromSecretKey(Uint8Array.from(parsed));
        }
    } catch {
        return null;
    }

    return null;
}

function getConnection() {
    if (!connectionSingleton) {
        connectionSingleton = new Connection(
            process.env.SOLANA_RPC_URL || clusterApiUrl(DEVNET_CLUSTER),
            'confirmed'
        );
    }

    return connectionSingleton;
}

async function loadAuthorityKeypair() {
    if (!authoritySingletonPromise) {
        authoritySingletonPromise = (async () => {
            await mkdir(CACHE_DIR, { recursive: true });

            const envKeypair = parseSecretKey(process.env.SOLANA_DEVNET_SECRET_KEY);
            if (envKeypair) {
                return envKeypair;
            }

            try {
                const persisted = JSON.parse(await readFile(AUTHORITY_PATH, 'utf8'));
                if (Array.isArray(persisted.secretKey) && persisted.secretKey.length > 0) {
                    return Keypair.fromSecretKey(Uint8Array.from(persisted.secretKey));
                }
            } catch {
                // Generate and persist a local devnet authority the first time we attest.
            }

            const generated = Keypair.generate();
            await writeFile(
                AUTHORITY_PATH,
                JSON.stringify({ secretKey: Array.from(generated.secretKey) }, null, 2),
                'utf8'
            );
            return generated;
        })();
    }

    return authoritySingletonPromise;
}

async function ensureBalance(connection, payer) {
    const balance = await connection.getBalance(payer.publicKey, 'confirmed');
    if (balance >= MINIMUM_BALANCE_LAMPORTS) {
        return balance;
    }

    if (!airdropPromise) {
        airdropPromise = (async () => {
            const signature = await connection.requestAirdrop(
                payer.publicKey,
                Math.max(TARGET_BALANCE_LAMPORTS - balance, 0.1 * LAMPORTS_PER_SOL)
            );
            const latestBlockhash = await connection.getLatestBlockhash('confirmed');
            await connection.confirmTransaction({
                signature,
                blockhash: latestBlockhash.blockhash,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
            }, 'confirmed');
        })().finally(() => {
            airdropPromise = null;
        });
    }

    await airdropPromise;
    return connection.getBalance(payer.publicKey, 'confirmed');
}

function digestSeed(...parts) {
    const hash = createHash('sha256');
    parts.forEach((part) => {
        hash.update(String(part || ''));
        hash.update('|');
    });
    return hash.digest().subarray(0, 32);
}

function sanitizeMemoText(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 220);
}

export function buildDeliveryMemo(delivery = {}) {
    const explicitMemo = sanitizeMemoText(delivery.solanaMemo);
    if (explicitMemo) return explicitMemo;

    const payload = sanitizeMemoText(delivery.payload || 'medical supplies');
    const route = [delivery.origin, delivery.destination].filter(Boolean).join('>');
    return sanitizeMemoText(`Aeroed custody ${delivery.id || 'pending'} ${payload} ${route}`);
}

export function deriveDeliveryPda(delivery = {}) {
    const [pda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('aeroed-custody'),
            digestSeed(delivery.id, delivery.origin, delivery.destination, delivery.createdAt),
        ],
        MEMO_PROGRAM_ID
    );
    return pda.toBase58();
}

export async function createSolanaAttestation(delivery = {}) {
    const connection = getConnection();
    const payer = await loadAuthorityKeypair();
    await ensureBalance(connection, payer);

    const memo = buildDeliveryMemo(delivery);
    const pda = deriveDeliveryPda(delivery);
    const instruction = new TransactionInstruction({
        programId: MEMO_PROGRAM_ID,
        keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: false },
            { pubkey: new PublicKey(pda), isSigner: false, isWritable: false },
        ],
        data: Buffer.from(memo, 'utf8'),
    });

    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirmTransaction(connection, transaction, [payer], {
        commitment: 'confirmed',
    });

    const transactionDetails = await connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
    });
    const signatureStatus = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
    });

    return {
        solanaTx: signature,
        solanaNetwork: DEVNET_CLUSTER,
        solanaSlot: transactionDetails?.slot ?? signatureStatus.value[0]?.slot ?? null,
        solanaProgram: MEMO_PROGRAM_ADDRESS,
        solanaMemo: memo,
        solanaAccountPda: pda,
        solanaExplorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${DEVNET_CLUSTER}`,
        solanaOnChain: true,
        solanaAttestedAt: new Date(),
        solanaAttestationError: '',
    };
}

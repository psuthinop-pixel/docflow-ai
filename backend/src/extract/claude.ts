// Optional high-accuracy extractor: Claude reads the receipt image/PDF directly.
import Anthropic from '@anthropic-ai/sdk';
import type { ReceiptFields } from './parse.js';

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-opus-5-5';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'vendor_name', 'vendor_taxid', 'vendor_address', 'invoice_number', 'date',
    'subtotal', 'tax_amount', 'total', 'currency', 'is_tax_invoice', 'category', 'raw_text',
  ],
  properties: {
    vendor_name: { type: 'string' },
    vendor_taxid: { type: 'string', description: '13-digit seller tax ID, digits only, or empty' },
    vendor_address: { type: 'string' },
    invoice_number: { type: 'string' },
    date: { type: ['string', 'null'], description: 'Issue date as YYYY-MM-DD in the Gregorian calendar (convert Buddhist Era: BE − 543)' },
    subtotal: { type: ['number', 'null'] },
    tax_amount: { type: ['number', 'null'], description: 'VAT amount' },
    total: { type: ['number', 'null'], description: 'Grand total paid, including VAT' },
    currency: { type: 'string' },
    is_tax_invoice: { type: 'boolean', description: 'True if the document is a ใบกำกับภาษี / tax invoice' },
    category: { type: 'string', description: 'Best match from the provided category list, or empty' },
    raw_text: { type: 'string', description: 'Full transcription of the document text' },
  },
} as const;

export type ClaudeFields = ReceiptFields & { category: string; raw_text: string };

let client: Anthropic | null = null;

export const claudeEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export async function extractWithClaude(buf: Buffer, mime: string, categories: string[]): Promise<ClaudeFields> {
  client ??= new Anthropic();
  const data = buf.toString('base64');
  const file =
    mime === 'application/pdf'
      ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } as const)
      : ({ type: 'image', source: { type: 'base64', media_type: mime as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data } } as const);

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          file,
          {
            type: 'text',
            text:
              'Extract the fields of this Thai or English receipt / tax invoice. Use the seller (not the buyer) for vendor fields. ' +
              `Expense categories: ${categories.length ? categories.join(', ') : '(none)'}.`,
          },
        ],
      },
    ],
  });

  if (!('content' in response)) throw new Error('Unexpected streaming response');
  if (response.stop_reason === 'refusal') throw new Error('Extraction was declined by the model');
  const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  return JSON.parse(text) as ClaudeFields;
}

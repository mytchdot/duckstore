import { z } from 'zod';
import { COLORS, MAX_DUCK_ID, MAX_QUANTITY, SHIPPING_MODES, SIZES } from '../../shared/contracts.js';

const decimalPriceSchema = z
    .string()
    // Browsers accept ".5" in a number input, so the whole-number part is optional. An empty string fails the refinement below.
    // abort stops the next check from adding a second, misleading message to a malformed price such as "-1".
    .regex(/^\d{0,8}(\.\d{1,2})?$/, { error: 'Enter a price with at most two decimal places, up to 99,999,999.99.', abort: true })
    .refine((value) => Number(value) > 0, 'Price must be greater than zero.');
// Accept JSON numbers too, without rounding away invalid fractional cents.
export const priceSchema = z.preprocess((value) => (typeof value === 'number' ? String(value) : value), decimalPriceSchema);
const quantity = z.number().int().min(0).max(MAX_QUANTITY);
export const idSchema = z
    .string()
    .regex(/^[1-9]\d{0,9}$/, 'Duck ID must be a positive whole number.')
    .transform(Number)
    .pipe(z.number().max(MAX_DUCK_ID, 'Duck ID is out of range.'));
export const addDuckSchema = z
    .object({
        color: z.enum(COLORS),
        size: z.enum(SIZES),
        price: priceSchema,
        quantity: quantity.min(1),
    })
    .strict();
export const editDuckSchema = z
    .object({
        price: priceSchema.optional(),
        quantity: quantity.optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, 'Supply price or quantity.');
export const orderSchema = z
    .object({
        color: z.enum(COLORS),
        size: z.enum(SIZES),
        quantity: quantity.min(1),
        destinationCountry: z.string().trim().min(1),
        shippingMode: z.enum(SHIPPING_MODES),
    })
    .strict();

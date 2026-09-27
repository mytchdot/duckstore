import { Decimal } from 'decimal.js';
import type { OrderInput, ShippingMode, Size } from '../../shared/contracts.js';

// Maximum supported subtotal has 18 integer digits. Keep ample precision for percentages.
const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
type PackageType = 'Wood' | 'Cardboard' | 'Plastic';
type Protection = 'Polystyrene balls' | 'Bubble wrap' | 'Moisture-absorbing beads';
const packageBySize: Record<Size, PackageType> = {
    XLarge: 'Wood',
    Large: 'Wood',
    Medium: 'Cardboard',
    Small: 'Plastic',
    XSmall: 'Plastic',
};

// Strategy pattern: select shipping-specific protection without a class hierarchy.
const protectionStrategies: Record<ShippingMode, (material: PackageType) => Protection[]> = {
    Land: () => ['Polystyrene balls'],
    Air: (material) => (material === 'Plastic' ? ['Bubble wrap'] : ['Polystyrene balls']),
    Sea: () => ['Moisture-absorbing beads', 'Bubble wrap'],
};

export interface Adjustment {
    code: string;
    description: string;
    amount: string;
    base: string;
    rate?: string;
}
interface PricingContext {
    total: Decimal;
    quantity: number;
    packageType: PackageType;
    country: string;
}
type PricingRule = (context: PricingContext) => Adjustment | null;
const packagingRates: Record<PackageType, string> = {
    Wood: '0.05',
    Cardboard: '-0.01',
    Plastic: '0.10',
};
const destinationRates = new Map([
    ['usa', '0.18'],
    ['bolivia', '0.13'],
    ['india', '0.19'],
]);
const money = (amount: Decimal) => amount.toFixed(2);
function percentage(code: string, description: string, base: Decimal, rate: string): Adjustment {
    return {
        code,
        description,
        base: money(base),
        rate,
        amount: money(base.mul(rate).toDecimalPlaces(2)),
    };
}

// Pipeline: rules run in the specification's order, each applied to the running total left by the rules before it.
const merchandiseRules: PricingRule[] = [
    ({ total, quantity }) =>
        quantity > 100 ? percentage('VOLUME_DISCOUNT', '20% discount for more than 100 ducks', total, '-0.20') : null,
    ({ total, packageType }) => percentage('PACKAGING', `${packageType} packaging adjustment`, total, packagingRates[packageType]),
    ({ total, country }) =>
        percentage('DESTINATION', `Destination charge (${country})`, total, destinationRates.get(country.toLowerCase()) ?? '0.15'),
];

// Strategy pattern: each shipping mode prices its own shipping, including any discount on that shipping.
interface ShippingCost {
    base: Decimal;
    discount: Adjustment | null;
}
const shippingStrategies: Record<ShippingMode, (quantity: number) => ShippingCost> = {
    Land: (quantity) => ({ base: new Money(10).mul(quantity), discount: null }),
    Air: (quantity) => {
        const base = new Money(30).mul(quantity);
        const discount =
            quantity > 1000 ? percentage('AIR_DISCOUNT', '15% Air shipping discount for more than 1,000 ducks', base, '-0.15') : null;
        return { base, discount };
    },
    Sea: () => ({ base: new Money(400), discount: null }),
};

export function calculateOrder(input: OrderInput, unitPrice: string) {
    const subtotal = new Money(unitPrice).mul(input.quantity);
    const packageType = packageBySize[input.size];
    const country = input.destinationCountry.trim();
    const adjustments: Adjustment[] = [];
    let total = subtotal;
    for (const rule of merchandiseRules) {
        const adjustment = rule({ total, quantity: input.quantity, packageType, country });
        if (!adjustment) continue;
        adjustments.push(adjustment);
        total = total.plus(adjustment.amount);
    }

    const shipping = shippingStrategies[input.shippingMode](input.quantity);
    adjustments.push({
        code: 'SHIPPING',
        description: `${input.shippingMode} shipping`,
        amount: money(shipping.base),
        base: money(shipping.base),
    });
    if (shipping.discount) adjustments.push(shipping.discount);
    const shippingTotal = shipping.base.plus(shipping.discount?.amount ?? 0);
    total = total.plus(shippingTotal);

    return {
        packageType,
        protectionTypes: protectionStrategies[input.shippingMode](packageType),
        currency: 'USD' as const,
        quantity: input.quantity,
        unitPrice: money(new Money(unitPrice)),
        merchandiseSubtotal: money(subtotal),
        adjustments,
        // This is a summary of shipping line items, not an additional charge.
        shipping: {
            mode: input.shippingMode,
            baseAmount: money(shipping.base),
            discountAmount: shipping.discount?.amount ?? '0.00',
            totalAmount: money(shippingTotal),
        },
        totalAmount: money(total),
    };
}

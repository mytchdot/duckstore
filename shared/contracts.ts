// Public API values and data shapes, shared by the browser and server.
export const COLORS = ['Red', 'Green', 'Yellow', 'Black'] as const;
export const SIZES = ['XLarge', 'Large', 'Medium', 'Small', 'XSmall'] as const;
export const SHIPPING_MODES = ['Land', 'Air', 'Sea'] as const;
export const MAX_QUANTITY = 2_147_483_647;
export const MAX_DUCK_ID = 2_147_483_647;

export type Color = (typeof COLORS)[number];
export type Size = (typeof SIZES)[number];
export type ShippingMode = (typeof SHIPPING_MODES)[number];

export interface Duck {
    id: number;
    color: Color;
    size: Size;
    price: string;
    quantity: number;
    deleted: boolean;
}

export interface AddDuckInput {
    color: Color;
    size: Size;
    price: string | number;
    quantity: number;
}

export type EditDuckInput = Partial<Pick<AddDuckInput, 'price' | 'quantity'>>;

export interface OrderInput {
    color: Color;
    size: Size;
    quantity: number;
    destinationCountry: string;
    shippingMode: ShippingMode;
}

export interface ErrorResponse {
    error: {
        code: string;
        message: string;
        fieldErrors?: Record<string, string[]>;
    };
}

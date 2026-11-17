/**
 * Rupay39 Checkout SDK
 * Drop-in helper to initialize dynamic UPI Hosted Checkout
 * 
 * Usage in JavaScript / React:
 * 
 * import { Rupay39Checkout } from "@/lib/checkout";
 * 
 * // 1. Create order and open hosted checkout
 * const order = await Rupay39Checkout.createOrder({
 *   amount: 450.00,
 *   purpose: "Daily EV Fleet Rental",
 *   customer_name: "Driver 001",
 * });
 * 
 * // 2. Open checkout in popup modal or redirect
 * Rupay39Checkout.open({
 *   orderId: order.order_id,
 *   onSuccess: (receipt) => console.log("Paid!", receipt),
 *   onClose: () => console.log("Checkout closed"),
 * });
 */

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || (typeof window !== "undefined" && window.location.hostname === "localhost" ? "http://localhost:8010" : "");
const API_BASE = `${BACKEND_URL}/api`;

export const Rupay39Checkout = {
  /**
   * Create a dynamic UPI checkout order
   */
  async createOrder({
    amount,
    purpose = "Route39 Payment",
    customer_name = "",
    customer_phone = "",
    customer_email = "",
    driver_id = null,
    vehicle_id = null,
    redirect_url = null,
    notes = {},
  }) {
    const res = await fetch(`${API_BASE}/api/checkout/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Number(amount),
        purpose,
        customer_name,
        customer_phone,
        customer_email,
        driver_id,
        vehicle_id,
        redirect_url,
        notes,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to create checkout order");
    }

    return await res.json();
  },

  /**
   * Check order status
   */
  async getStatus(orderId) {
    const res = await fetch(`${API_BASE}/api/checkout/orders/${orderId}`);
    if (!res.ok) throw new Error("Order not found");
    return await res.json();
  },

  /**
   * Open checkout in a popup modal or window
   */
  open({ orderId, onSuccess, onClose, mode = "popup" }) {
    const checkoutUrl = `/pay/${orderId}`;

    if (mode === "redirect") {
      window.location.href = checkoutUrl;
      return;
    }

    // Popup window mode
    const width = 480;
    const height = 750;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    const popup = window.open(
      checkoutUrl,
      `Rupay39_Checkout_${orderId}`,
      `width=${width},height=${height},top=${top},left=${left},resizable=yes,scrollbars=yes,status=no`
    );

    // Poll for status until closed or success
    if (popup) {
      const timer = setInterval(async () => {
        try {
          if (popup.closed) {
            clearInterval(timer);
            if (onClose) onClose();
            return;
          }
          const order = await Rupay39Checkout.getStatus(orderId);
          if (order.status === "SUCCESS") {
            clearInterval(timer);
            if (onSuccess) onSuccess(order);
          }
        } catch {
          // ignore transient poll error
        }
      }, 2000);
    } else {
      // If popup blocker blocked it, redirect directly
      window.location.href = checkoutUrl;
    }
  },
};

if (typeof window !== "undefined") {
  window.Rupay39Checkout = Rupay39Checkout;
}


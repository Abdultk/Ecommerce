import type { ConfirmTransferInput } from "@hp/contracts";
import { AppError } from "../../lib/errors";
import { markOrderPaid, sendFollowUpMail, type FollowUp } from "../payments/payment-events";
import { ORDER_DETAIL_INCLUDE, isOffline } from "./order-view";
import type { AuditInTx, OrderDeps } from "./orders.service";
import { lockOrder } from "./stock";

/**
 * An admin confirms that a customer's bank transfer arrived. Only for bank-transfer orders
 * still awaiting payment (an expired, cancelled one gets 409). The amount received must equal
 * the total, else 422 AMOUNT_MISMATCH and nothing changes (staff contact the customer).
 * Goes through markOrderPaid like every other payment: commits stock, empties the cart,
 * writes the order event and sends the payment-confirmed email.
 */
export async function confirmTransfer(
  deps: OrderDeps,
  orderId: string,
  input: ConfirmTransferInput,
  actorId: string,
  audit: AuditInTx,
): Promise<void> {
  const followUp: FollowUp = { mail: [] };
  await deps.db.$transaction(async (tx) => {
    if (!(await lockOrder(tx, orderId))) throw new AppError("NOT_FOUND", "Order not found.");
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: ORDER_DETAIL_INCLUDE,
    });
    if (!isOffline(order.paymentMethod)) {
      throw new AppError(
        "CONFLICT",
        "Only bank-transfer and manual-payment orders can be confirmed this way.",
      );
    }
    if (order.status !== "PENDING_PAYMENT") {
      throw new AppError(
        "CONFLICT",
        order.status === "CANCELLED"
          ? "This order was cancelled (the transfer didn't arrive in time). Contact the customer."
          : "This order isn't awaiting a transfer.",
      );
    }
    if (input.receivedCents !== order.totalCents) {
      throw new AppError("AMOUNT_MISMATCH", "The amount received doesn't match the order total.", {
        expectedCents: order.totalCents,
        receivedCents: input.receivedCents,
      });
    }
    await markOrderPaid(
      tx,
      order,
      {
        amountCents: input.receivedCents,
        providerPaymentId: null,
        transfer: { bankReference: input.bankReference, confirmedById: actorId, note: input.note },
      },
      followUp,
    );
    await audit(tx, order);
  });
  await sendFollowUpMail(deps, followUp.mail);
}

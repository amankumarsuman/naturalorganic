import { stripe } from "../../index.js";
import axios from "axios";
import jwt from "jsonwebtoken";
import generateId from "../../utils/generateId.js";
import { ORDERS_BASEURL, WEBSITE_BASE_URL } from "../../services/BaseURLs.js";
import crypto from "crypto";
export const createCheckoutSession = async (req, res) => {
  try {
    const { products, total } = jwt.verify(
      req.body.token,
      process.env.JWT_SECRET_KEY
    );
    const { data } = req.body;
    const order_id = generateId();
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: products.map((product) => {
        return {
          price_data: {
            currency: "INR",
            product_data: {
              name: product.name,
            },
            unit_amount: parseInt(product.price * 100),
          },
          quantity: product.quantity || 1,
        };
      }),
      payment_intent_data: {
        metadata: {
          order_id: order_id,
          firstName: data.name.first,
          lastName: data.name.last,
          email: data.email,
          phone_number: data.phone_number,
          address: JSON.stringify({
            country: data.address.country,
            city: data.address.city,
            area: data.address.area,
            street: data.address.street,
            building_number: data.address.building_number,
            floor: data.floor,
            apartment_number: data.address.apartment_number,
          }),
          products: JSON.stringify(
            products.map((product) => {
              return {
                product_id: product.product_id,
                name: product.name,
                quantity: product.quantity,
              };
            })
          ),
          total: total,
        },
      },
      success_url: `${WEBSITE_BASE_URL}/checkout/success?order=${order_id}`,
      cancel_url: `${WEBSITE_BASE_URL}/cart`,
    });
    res.status(201).json({ url: session.url });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
  // try {
  //   const { orderId, amount, email, phone } = req.body;
  //   console.log(req.body);
  //   // Generate a unique transaction ID using the order ID and current timestamp
  //   const transactionId = orderId + Date.now();

  //   // Create a checksum hash using the merchant key and payment request parameters
  //   const paytmParams = {
  //     MID: process.env.YOUR_MERCHANT_ID_HERE,
  //     WEBSITE: "WEBSTAGING",
  //     CHANNEL_ID: "WEB",
  //     INDUSTRY_TYPE_ID: "Retail109",
  //     ORDER_ID: orderId,
  //     TXN_AMOUNT: amount.toString(),
  //     CUST_ID: phone,
  //     MOBILE_NO: phone,
  //     EMAIL: email,
  //     CALLBACK_URL: "http://localhost:3000",
  //     TRANSACTION_ID: transactionId,
  //   };
  //   const paytmChecksum = await generateChecksum(
  //     paytmParams,
  //     process.env.YOUR_MERCHANT_KEY_HERE
  //   );

  //   // Construct the payment request URL with the merchant ID, checksum hash, and payment request parameters
  //   let paymentUrl = `https://securegw-stage.paytm.in/theia/processTransaction?mid=${paytmParams.MID}&orderId=${paytmParams.ORDER_ID}`;
  //   paymentUrl += `&txnAmount=${paytmParams.TXN_AMOUNT}&channelId=${paytmParams.CHANNEL_ID}`;
  //   paymentUrl += `&website=${paytmParams.WEBSITE}&industryTypeId=${paytmParams.INDUSTRY_TYPE_ID}`;
  //   paymentUrl += `&callbackUrl=${paytmParams.CALLBACK_URL}&txnId=${paytmParams.TRANSACTION_ID}`;

  //   // Return the payment URL to the client
  //   res.json({ paymentUrl });
  // } catch (error) {
  //   console.error(error);
  //   res.status(500).json({ message: "Internal server error" });
  // }
};

export const webhook = async (req, res) => {
  const eventType = req.body.type;
  const { metadata } = req.body.data.object;
  try {
    if (eventType === "charge.succeeded") {
      await axios.post(ORDERS_BASEURL, { data: metadata });
    }
    res.status(200).json(metadata);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};
export const verifyPayment = async (req, res) => {
  try {
    const { ORDERID, TXNID } = req.body;

    // Verify the authenticity of the Paytm response using the checksum hash
    const paytmChecksum = await generateChecksum(
      { ORDERID, TXNID },
      process.env.YOUR_MERCHANT_KEY_HERE
    );
    const isValidChecksum = req.body.CHECKSUMHASH === paytmChecksum;
    if (!isValidChecksum) {
      console.error("Invalid checksum");
      return res.status(400).json({ message: "Invalid checksum" });
    }

    // Call the Paytm API to fetch the payment details
    const paytmParams = { MID: "YOUR_MERCHANT_ID_HERE", ORDERID, TXNID };
    const paytmChecksum2 = await generateChecksum(
      paytmParams,
      process.env.YOUR_MERCHANT_KEY_HERE
    );
    const response = await axios.post(
      `https://securegw-stage.paytm.in/order/status`,
      paytmParams,
      {
        headers: {
          "Content-Type": "application/json",
          checksumhash: paytmChecksum2,
        },
      }
    );

    // Return the payment details to the client
    const { TXNAMOUNT, STATUS, TXNDATE, BANKTXNID } = response.data.body;
    res.json({
      amount: TXNAMOUNT,
      status: STATUS,
      date: TXNDATE,
      bankTransactionId: BANKTXNID,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Function to generate the Paytm checksum hash
async function generateChecksum(params, merchantKey) {
  const sortedParams = Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      acc[key] = params[key];
      return acc;
    }, {});

  const paramString = Object.values(sortedParams).join("|");
  const salt = await generateSalt(4);
  const rawSignature = `${paramString}|${salt}`;
  const hash = crypto
    .createHmac("sha256", merchantKey)
    .update(rawSignature)
    .digest("hex");
  const checksum = `${hash}${salt}`;
  return checksum;
}

// Function to generate a random salt for the Paytm checksum hash
async function generateSalt(length) {
  return new Promise((resolve, reject) => {
    crypto.randomBytes(length, (error, buffer) => {
      if (error) {
        reject(error);
      } else {
        resolve(buffer.toString("hex"));
      }
    });
  });
}

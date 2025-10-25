// server.js
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;
// This is your test secret API key.
const stripe = require("stripe")(process.env.Stripe_Payment_Secret);


// Middleware
app.use(cors());
app.use(express.json());

// DB_USER=fast_delivery_user
// DB_PASS=CfN5gObfcL4K6YJf
// MONGODB_URI=mongodb+srv://fast_delivery_user:CfN5gObfcL4K6YJf@cluster0.shcxnwl.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0

const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        const db = client.db('parcelsDB');
        const parcelsCollection = db.collection("parcels");
        const paymentsCollection = db.collection("payments");
        const usersCollection = db.collection("users");

        // (parcels related apis)

        // get users own parcels
        app.get("/parcels/user", async (req, res) => {
            const userEmail = req.query.email;
            const page = parseInt(req.query.page);
            const limit = parseInt(req.query.limit);
            const skip = (page - 1) * limit;
            const search = req.query.search;

            const query = {
                createdBy: userEmail,
                ...(search && {
                    $or: [
                        { title: { $regex: search, $options: "i" } },
                        { senderContact: { $regex: search, $options: "i" } },
                        { trackingId: { $regex: search, $options: "i" } },
                        { status: { $regex: search, $options: "i" } },
                        { senderName: { $regex: search, $options: "i" } },
                    ]
                })
            }

            if (!userEmail) {
                return res.status(400).send({ message: "Email is required" });
            }
            const sortField = { creationDate: -1 }
            const parcels = await parcelsCollection.find(query).sort(sortField).skip(skip).limit(limit).toArray();
            const totalParcels = await parcelsCollection.estimatedDocumentCount(query)
            res.send({ parcels, totalParcels });
        });

        // get single parcel by id
        app.get('/parcels/:parcelId', async (req, res) => {
            const { parcelId } = req.params;
            const filter = { _id: new ObjectId(parcelId) };
            const parcel = await parcelsCollection.findOne(filter);
            res.send(parcel)
        })

        // get all parcels
        app.get("/parcels", async (req, res) => {
            const parcels = await parcelsCollection.find().toArray();
            res.send(parcels);
        });

        // post a parcel
        app.post("/parcels", async (req, res) => {
            const newParcel = req.body;
            const result = await parcelsCollection.insertOne(newParcel);
            res.send(result);
        });

        // delete a parcel
        app.delete("/parcels/:parcelId", async (req, res) => {
            const { parcelId } = req.params;
            const result = await parcelsCollection.deleteOne({ _id: new ObjectId(parcelId) });
            res.send(result)
        });


        //  (payment related apis)

        // get all payment history for admin
        app.get('/payments', async (req, res) => {
            const result = await paymentsCollection.find({ createdAt: -1 }).toArray();
            res.send(result);
        });

        // get user payment history
        app.get('/payments/user', async (req, res) => {
            const userEmail = req.query.email;

            const result = await paymentsCollection.find({ userEmail: userEmail }).toArray();

            res.send(result);
        });

        // update parcel payment status
        app.patch("/parcels/payment/:parcelId", async (req, res) => {
            const { parcelId } = req.params;
            const filter = { _id: new ObjectId(parcelId) };

            const update = {
                $set: {
                    paymentStatus: 'paid'
                }
            }

            const result = await parcelsCollection.updateOne(filter, update);

            res.send(result)
        });

        // post a parcel payment
        app.post("/payments", async (req, res) => {
            const paymentRecord = req.body;

            const isExistRecord = await paymentsCollection.findOne(paymentRecord.parcelId);
            if (isExistRecord) {
                return res.status(403).send({ message: 'forbidden action' })
            };

            const result = await paymentsCollection.insertOne(paymentRecord);
            res.send(result);
        });

        // stripe Create payment intent endpoint
        app.post("/create-payment-intent", async (req, res) => {
            const { amountInCents, parcelId } = req.body;

            if (!parcelId) {
                return res.status(400).send({ message: "Parcel ID required" });
            }

            // Create a PaymentIntent with the order amount and currency
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amountInCents,
                currency: "usd",
                // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
                automatic_payment_methods: {
                    enabled: true,
                },
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });

        // (users related api)

        // post user info in db
        app.post("/users", async (req, res) => {
            const user = req.body;
            const query = { email: user.email };

            const isExistingUser = await usersCollection.findOne(query);
            if (isExistingUser) {
                return res.send({ message: "User already exists", insertedId: null });
            }

            const result = await usersCollection.insertOne(user);
            res.send(result);
        })

        

        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



// Test Route
app.get("/", (req, res) => {
    res.send("🎁 Parcel Delivery Server is Running...");
});

// Start Server
app.listen(port, () => {
    console.log(`Server is running on port: ${port}`);
});

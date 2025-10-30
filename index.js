// server.js
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;
// This is your test secret API key.
const stripe = require("stripe")(process.env.Stripe_Payment_Secret);
// firebase admin token
const admin = require('firebase-admin');
const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)

// initialize firebase admin
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// Middleware
app.use(express.json());
app.use(cors());


// Verify Firebase Token Middleware
const verifyFirebaseToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).send({ message: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.user = decoded; // Firebase user info
        next();
    } catch (err) {
        res.status(401).send({ message: 'Invalid token' });
    }
};

// Role Middleware
const verifyRole = (allowedRoles) => async (req, res, next) => {
    const userEmail = req.user?.email;
    const user = await req.app.locals.usersCollection.findOne({ email: userEmail });
    if (!user || !allowedRoles.includes(user.role)) {
        return res.status(403).send({ message: 'Forbidden' });
    }
    req.userRole = user.role;
    next();
};

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
        const ridersCollection = db.collection("riders");

        // access the database collection global
        app.locals.usersCollection = usersCollection;
        app.locals.paymentsCollection = paymentsCollection;
        app.locals.parcelsCollection = parcelsCollection;
        app.locals.ridersCollection = ridersCollection;



        // (parcels related apis)

        // get users own parcels and search parcel and pagination
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
            const page = parseInt(req.query.page);
            const limit = parseInt(req.query.limit);
            const search = req.query.search;
            const skip = (page - 1) * limit;

            const query = {
                userEmail: userEmail,
                ...({
                    $or: [
                        { transactionId: { $regex: search, $options: "i" } },
                        { userEmail: { $regex: search, $options: "i" } },
                    ]
                })
            }

            const result = await paymentsCollection.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();
            const totalPayments = await paymentsCollection.countDocuments(query);
            res.send({ result, totalPayments });
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

            const isExistRecord = await paymentsCollection.findOne({ _id: new ObjectId(paymentRecord.parcelId) });
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

        // (users related apis)

        // get all the user and search user
        app.get('/users', async (req, res) => {
            const search = req.query.search;
            const page = parseInt(req.query.page);
            const limit = parseInt(req.query.limit);
            const skip = (page - 1) * limit;

            const query = {
                email: { $regex: search, $options: "i" }
            }

            const users = await usersCollection.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();

            const totalUsers = await usersCollection.countDocuments(query);

            res.status(200).send({ users, totalUsers });
        })

        // get single user info
        app.get("/users/user", async (req, res) => {
            const { email } = req.query;

            if (!email) {
                return res.status(404).send({ message: "user not found" });
            }
            const filter = { email: email }
            const result = await usersCollection.findOne(filter);
            res.status(200).send(result);
        })

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

        // delete a user and also if the user is a rider
        app.delete("/users/:userId", async (req, res) => {
            const { userId } = req.params;
            const { userEmail } = req.body;

            console.log('userid and userEmail', userEmail);

            const filter = { _id: new ObjectId(userId) };

            if (!userId || !userEmail) {
                return res.status(400).send({
                    success: false,
                    message: "Missing required fields"
                });
            }

            const isExistedRider = await ridersCollection.findOne({ email: userEmail });

            if (isExistedRider) {
                const deleteRider = await ridersCollection.deleteOne({ email: userEmail });
            }

            const deleteUser = await usersCollection.deleteOne(filter);
            res.status(204).send(deleteUser)
        })

        // (riders related apis)

        // get all pending riders and search pending riders and pagination
        app.get('/riders/pending', async (req, res) => {
            const page = parseInt(req.query.page);
            const limit = parseInt(req.query.limit);
            const search = req.query.search;
            const skip = (page - 1) * limit;

            const query = {
                status: "pending",
                ...(search && {
                    $or: [
                        { email: { $regex: search, $options: "i" } },
                        { phone: { $regex: search, $options: "i" } },
                    ]
                })
            };
            const result = await ridersCollection.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();
            const countRiders = await ridersCollection.countDocuments(query);
            res.status(200).send({ result, countRiders });
        })

        // get all active riders and search active riders and pagination
        app.get('/riders/active', async (req, res) => {
            const page = parseInt(req.query.page);
            const limit = parseInt(req.query.limit);
            const search = req.query.search;
            const skip = (page - 1) * limit;

            const query = {
                status: "active",
                ...(search && {
                    $or: [
                        { email: { $regex: search, $options: "i" } },
                        { phone: { $regex: search, $options: "i" } },
                    ]
                })
            };
            const result = await ridersCollection.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();
            const countRiders = await ridersCollection.countDocuments(query);
            res.status(200).send({ result, countRiders });
        })

        // get single rider info
        app.get('/riders', async (req, res) => {
            const { email } = req.query;
            if (!email) {
                return res.status(404).send({ message: "user not found" });
            }
            const filter = { email: email }
            const result = await ridersCollection.findOne(filter);
            res.status(200).send(result);
        });

        // update rider status pending to active or active to pending
        app.patch("/riders/status/:riderId", async (req, res) => {
            const { riderId } = req.params;
            const { makeStatus, riderEmail } = req.body;

            console.log('make status', riderEmail);
            const filter = { _id: new ObjectId(riderId) };

            let update = {}
            let userRole = "";
            if (makeStatus === "active") {
                userRole = "rider";
                update = {
                    $set: {
                        status: "active"
                    }
                };
            }
            else if (makeStatus === "pending") {
                userRole = "user";
                update = {
                    $set: {
                        status: "pending"
                    }
                };
            }

            // update user role and rider status
            const [userUpdateResult, riderUpdateResult] = await Promise.all([
                usersCollection.updateOne({ email: riderEmail }, { $set: { role: userRole } }),
                ridersCollection.updateOne(filter, update)
            ]);

            if (userUpdateResult.modifiedCount === 0 || riderUpdateResult.modifiedCount === 0) {
                return res.status(400).send({ message: "failed to update user or rider status" })
            }

            res.status(200).send({
                success: true,
                message: `Rider status updated to ${makeStatus} successfully`,
                data: {
                    userUpdate: userUpdateResult,
                    riderUpdate: riderUpdateResult
                }
            });
        })

        // post rider info in db
        app.post("/riders", async (req, res) => {
            const riderData = req.body;

            const isExisted = await ridersCollection.findOne({ email: riderData.email });

            if (!riderData.email) {
                return res.status(404).send({ message: "data does not exists" })
            }

            if (isExisted) {
                return res.status(409).send({ message: "data already exists" })
            }

            const result = await ridersCollection.insertOne(riderData);

            res.status(201).send(result);
        })

        // delete a rider
        app.delete("/riders/:riderId", async (req, res) => {
            const { riderId } = req.params;
            const filter = { _id: new ObjectId(riderId) };
            const result = await ridersCollection.deleteOne(filter);
            res.status(204).send(result);
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

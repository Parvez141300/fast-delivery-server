// server.js
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

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

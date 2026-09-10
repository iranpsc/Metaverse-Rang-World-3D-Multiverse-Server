// File ==>  src\infra\mongo\connection.js

import mongoose from 'mongoose';
import logger from '../../utils/logger.js';

export async function connectDatabase() {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/metaverse';

    try {
        await mongoose.connect(mongoUri);
        logger.info("🍃 Connected to MongoDB successfully.");
    } catch (error) {
        logger.error("❌ MongoDB connection error:", { error: error.message });
        process.exit(1); // اگر دیتابیس وصل نشود، سرور نباید بالا بیاید
    }
}

import { v4 as uuidv4 } from "uuid";
import { globalHeaders, logTrace, getSessionId, createResponse, setRequestContext, logError } from "../helper/helper.js";
import { verifyToken } from "./authorizerLayer.js";
import { DynamoDBClient, PutItemCommand, GetItemCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
const dynamo = new DynamoDBClient({ region: process.env.REGION });

export const handler = async (event, context) => {
    setRequestContext(event, context);
    
    try {
        // --- Token Verification ---
        const authVerification = await verifyToken(event);
        if (authVerification?.principalId === "unknown") {
            return createResponse(401, { message: "Unauthorized: Invalid or expired token" });
        }

        const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
        const conversationId = uuidv4();
        const { searchKey, hotelKey, propertyInfo, rooms, totalPrice, flag } = body
        // --- Session ID from Provesio ---
        const { sessionId } = await getSessionId(authVerification?.context?.sub, searchKey);
        if (!sessionId) {
            return createResponse(500, { message: "Login failed, no sessionId returned." });
        }

        // Validate required fields
        if (!searchKey || !hotelKey || !propertyInfo || !rooms || !totalPrice) {
            return createResponse(400, { message: "Missing required fields: searchKey, hotelKey, propertyInfo, rooms, totalPrice." });
        }

        // Validate propertyInfo is an object
        if (typeof propertyInfo !== 'object' || Array.isArray(propertyInfo) || propertyInfo === null) {
            return createResponse(400, { message: "Invalid propertyInfo: must be a non-null object." });
        }

        // Validate rooms is an array of objects
        if (!Array.isArray(rooms) || rooms.some(room => typeof room !== 'object' || room === null)) {
            return createResponse(400, { message: "Invalid rooms: must be an array of objects." });
        }

        if (!conversationId) {
            return createResponse(500, { message: "Login failed, no conversationId returned." });
        }

        const getHotelFavourite = new GetItemCommand({
            TableName: process.env.HOTEL_FAVOURITES_TABLE,
            Key: {
                hotelKey: { S: hotelKey },
                roomKey: { S: rooms[0].roomKey }
            }
        });
        const result = await dynamo.send(getHotelFavourite);
        console.log("result*********", result);
        if (flag) {
            if (result.Item) {
                return createResponse(422, { message: "User has already added this room to favourites" });
            }
        } else {
            if (result.Item) {
                const deleteHotelFavourite = new DeleteItemCommand({
                    TableName: process.env.HOTEL_FAVOURITES_TABLE,
                    Key: {
                        hotelKey: { S: hotelKey },
                        roomKey: { S: rooms[0].roomKey }
                    }
                });

                await dynamo.send(deleteHotelFavourite);

                console.log("Favourite room deleted successfully");
                return createResponse(200, { message: "Room removed from favourites successfully." });
            }
        }
        const item = {
            // 🔑 Keys
            hotelKey: { S: hotelKey },      // Partition Key
            roomKey: { S: rooms[0].roomKey },        // Sort Key

            searchKey: { S: searchKey },
            propertyInfo: { S: JSON.stringify(propertyInfo) },
            totalPrice: { S: String(totalPrice) },

            // 📦 Room details (stringified)
            roomDetails: { S: JSON.stringify(rooms) },

            // 👤 User info (optional, if needed)
            userId: { S: authVerification?.context?.sub },
            userType: { S: authVerification?.context?.userType },
            // 📌 Meta
            createdAt: { S: new Date().toISOString() },
            updatedAt: { S: new Date().toISOString() }
        }
        console.log("item*********", item);

        const putCmd = new PutItemCommand({
            TableName: process.env.HOTEL_FAVOURITES_TABLE,
            Item: item
        });

        await dynamo.send(putCmd);

        const payload = {
            id: uuidv4(),
            userId: authVerification?.context?.sub,
            userType: authVerification?.context?.userType,
            request: { ...body },
            response: null,
            stepCode: 150,
            status: "active"
        };

        await logTrace(payload);

        return createResponse(200, { message: "Hotel favourite saved successfully!" });

    } catch (error) {
        console.error("Error in Add Hotel Favourites:", error.response?.data || error.message, error.stack);
        
        await logError(error, {
            function: 'addHotelFavourites',
            event: JSON.stringify(event)
        });
        
        return createResponse(500, {
            message: error.response?.data || "Internal Server Error",
            error: error.response?.data || error.message,
            stack: error.stack
        });
    }
};

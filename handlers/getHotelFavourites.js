import { v4 as uuidv4 } from "uuid";
import { globalHeaders, logTrace, getSessionId, createResponse, setRequestContext, logError } from "../helper/helper.js";
import { verifyToken } from "./authorizerLayer.js";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
const dynamo = new DynamoDBClient({ region: process.env.REGION });

export const handler = async (event, context) => {
    setRequestContext(event, context);
    
    try {
        // --- Token Verification ---
        const authVerification = await verifyToken(event);
        if (authVerification?.principalId === "unknown") {
            return createResponse(401, { message: "Unauthorized: Invalid or expired token" });
        }
        const city = event.queryStringParameters?.city; 
        const { sessionId } = await getSessionId(authVerification?.context?.sub);
        if (!sessionId) {
            return createResponse(500, { message: "Login failed, no sessionId returned." });
        }

        const queryCmd = new QueryCommand({
            TableName: process.env.HOTEL_FAVOURITES_TABLE,
            IndexName: "userId-index",
            KeyConditionExpression: "userId = :uid",
            ExpressionAttributeValues: {
                ":uid": { S: authVerification?.context?.sub }
            }
        });

        const result = await dynamo.send(queryCmd);
        const items = result.Items ? result.Items.map(item => unmarshall(item)) : [];

        let filteredItems = items;

        if (city) {
            filteredItems = items.filter(item => item.city === city);
        }

        const grouped = filteredItems.reduce((acc, item) => {
            const c = item.city;
            if (!acc[c]) acc[c] = [];
            acc[c].push(item);
            return acc;
        }, {});

        const payload = {
            id: uuidv4(),
            userId: authVerification?.context?.sub,
            userType: authVerification?.context?.userType,
            request: null,
            response: null,
            stepCode: 160,
            status: "active"
        };

        await logTrace(payload);

        return createResponse(200, items);

    } catch (error) {
        console.error("Error in Get Hotel Favourites:", error.response?.data || error.message, error.stack);
        
        await logError(error, {
            function: 'getHotelFavourites',
            event: JSON.stringify(event)
        });
        
        return createResponse(500, {
            message: error.response?.data || "Internal Server Error",
            error: error.response?.data || error.message,
            stack: error.stack
        });
    }
};

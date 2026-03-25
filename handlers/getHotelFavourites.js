import { v4 as uuidv4 } from "uuid";
import { globalHeaders, logTrace, getSessionId } from "../helper/helper.js";
import { verifyToken } from "./authorizerLayer.js";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
const dynamo = new DynamoDBClient({ region: process.env.REGION });

export const handler = async (event) => {
    try {
        // --- Token Verification ---
        const authVerification = await verifyToken(event);
        if (authVerification?.principalId === "unknown") {
            return {
                ...globalHeaders(),
                statusCode: 401,
                body: JSON.stringify({ message: "Unauthorized: Invalid or expired token" }),
            };
        }

        const { sessionId } = await getSessionId(authVerification?.context?.sub);
        if (!sessionId) {
            return {
                ...globalHeaders(),
                statusCode: 500,
                body: JSON.stringify({ message: "Login failed, no sessionId returneds." }),
            };
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

        console.log("result*********", items);
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


        return { statusCode: 200, ...globalHeaders(), body: JSON.stringify(items) };

    } catch (error) {
        console.error("Error in Add Hotel Favourites:", error.response?.data || error.message, error.stack);
        return {
            statusCode: 500,
            headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Credentials": true },
            body: JSON.stringify({
                message: error.response?.data || "Internal Server Error",
                error: error.response?.data || error.message,
            }),
        };
    }
};

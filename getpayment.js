const Razorpay = require("razorpay");
const AWS = require("aws-sdk");
const s3 = new AWS.S3();
const crypto = require("crypto");
const jwt = require('jsonwebtoken');
require('dotenv').config();

const BUCKET_NAME = process.env.BUCKET_NAME;
const JWT_SECRET = process.env.JWT_SECRET;
const MOVIE_TABLE = 'movie-data';
const USERS_TABLE = 'user-data';
const dynamodb = new AWS.DynamoDB.DocumentClient();

const formatResponse = (statusCode, body) => {
    return {
        statusCode: statusCode,
        headers: {
            'Access-Control-Allow-Origin': 'http://localhost:3000',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Credentials': 'true',
        },
        body: JSON.stringify(body),
    };
};

exports.createpaymenthandler = async (event) => {
    console.log("Received event:", JSON.stringify(event, null, 2));

    let movie_id;
    try {
        const body = JSON.parse(event.body);
        movie_id = body.movie_id;
        if (!movie_id) {
            return formatResponse(400, { message: "movie_id is required" });
        }
    } catch (error) {
        console.error("Error parsing event body:", error);
        return formatResponse(400, { message: "Invalid request body" });
    }

    const jwt_token = event.headers.Cookie || event.headers.cookie;
    const { isAuthorized, user } = verifyJwtFromCookies({ headers: { Cookie: jwt_token } });

    if (!isAuthorized) {
        return formatResponse(401, { message: "Unauthorized" });
    }

    try {
        const movie = await getMovieDetails(movie_id);

        const instance = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_SECRET,
        });

        const order = await instance.orders.create({
            amount: movie.price * 100, // Amount in paisa
            currency: "INR",
            receipt: `receipt_${movie_id}_${user.email}`,
        });

        return formatResponse(200, {
            order_id: order.id,
            amount: order.amount,
            key: process.env.RAZORPAY_KEY_ID, 
        });
    } catch (error) {
        console.error("Error creating order:", error);
        return formatResponse(500, { message: "Error creating order" });
    }
};

const getMovieDetails = async (movie_id) => {
    const params = {
        TableName: MOVIE_TABLE,
        Key: { movie_id },
    };

    try {
        const result = await dynamodb.get(params).promise();
        return result.Item;
    } catch (error) {
        console.error("Error fetching movie details:", error);
        throw new Error("Movie not found.");
    }
};

const verifyJwtFromCookies = (event) => {
    try {
        const cookieHeader = event.headers.Cookie || event.headers.cookie;

        if (!cookieHeader) {
            return { isAuthorized: false, message: 'Unauthorized: No cookies present' };
        }

        const token = cookieHeader
            .split('; ')
            .find((row) => row.startsWith('jwt='))
            ?.split('=')[1];

        if (!token) {
            return { isAuthorized: false, message: 'Unauthorized: JWT not found in cookies' };
        }

        const decoded = jwt.verify(token, JWT_SECRET);

        if (!decoded) {
            return { isAuthorized: false, message: 'Unauthorized: Invalid token' };
        }

        return { isAuthorized: true, user: decoded };
    } catch (error) {
        console.error('JWT Verification Error:', error);
        return { isAuthorized: false, message: 'Internal Server Error during token verification' };
    }
};

exports.verifypaymenthandler = async (event) => {
    const {
        razorpay_payment_id,
        razorpay_order_id,
        razorpay_signature,
        movie_id,
    } = JSON.parse(event.body);

    const jwt_token = event.headers.Cookie || event.headers.cookie;
    const { isAuthorized, user } = verifyJwtFromCookies({ headers: { Cookie: jwt_token } });

    if (!isAuthorized) {
        return formatResponse(401, { message: "Unauthorized" });
    }

    try {
        const instance = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_SECRET,
        });

        const generated_signature = crypto
            .createHmac("sha256", process.env.RAZORPAY_SECRET)
            .update(razorpay_order_id + "|" + razorpay_payment_id)
            .digest("hex");

        if (generated_signature === razorpay_signature) {
            const currentDate = new Date();
            const endDate = new Date(currentDate);
            endDate.setDate(currentDate.getDate() + 3); 

            const movie = await getMovieDetails(movie_id);
            const movie_url=movie.movie_url;
            const params = {
                TableName: USERS_TABLE,
                Key: { email: user.email },
                UpdateExpression: "SET current_rented_movies = list_append(if_not_exists(current_rented_movies, :empty_list), :movie)",
                ExpressionAttributeValues: {
                    ":movie": [{
                        end_date: endDate.toISOString(),
                        movie_id,
                        poster_url: movie.poster_url,
                        start_date: currentDate.toISOString(),
                        title: movie.title,
                    }],
                    ":empty_list": [],
                },
                ReturnValues: "UPDATED_NEW",
            };

            await dynamodb.update(params).promise();
            let movieResponse='';
            if (movie_url) {
                const s3Params = {
                    Bucket: BUCKET_NAME,
                    Key: `MovieVideo/${movie_url}`,
                    Expires: 600,
                };
    
                const presignedUrl = await s3.getSignedUrlPromise('getObject', s3Params);
                movieResponse = presignedUrl;
            }


            return formatResponse(200, { success: true, message: movieResponse });
        } else {
            return formatResponse(400, { success: false, message: "Payment verification failed." });
        }
    } catch (error) {
        console.error("Error verifying payment:", error);
        return formatResponse(500, { success: false, message: "Error verifying payment." });
    }
};

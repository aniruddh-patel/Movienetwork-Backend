const AWS = require('aws-sdk');
const s3 = new AWS.S3();
require('dotenv').config();
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
const dynamoDb = new AWS.DynamoDB.DocumentClient();


const MOVIE_TABLE = 'movie-data';
const USERS_TABLE = 'user-data';
const BUCKET_NAME = process.env.BUCKET_NAME;

const fetchMoviesByGenre = async (genre, fetchLimit = 20, returnLimit = 8) => {
    const params = {
        TableName: MOVIE_TABLE,
        IndexName: 'genre-index',
        KeyConditionExpression: '#g = :genreVal',
        ExpressionAttributeNames: {
            '#g': 'genre',
        },
        ExpressionAttributeValues: {
            ':genreVal': genre,
        },
        ProjectionExpression: 'movie_id, title, genre, poster_url, created_at',
        Limit: fetchLimit 
    };

    try {
        const result = await dynamoDb.query(params).promise();
        const movies = result.Items || [];

        const shuffledMovies = movies.sort(() => 0.5 - Math.random());
        return shuffledMovies.slice(0, returnLimit);
    } catch (error) {
        console.error("Error fetching movies by genre:", error);
        throw new Error("Error fetching movies by genre");
    }
};

exports.handler = async (event) => {
    try {
        
        const actionMovies = await fetchMoviesByGenre('Action');
        const comedyMovies = await fetchMoviesByGenre('Comedy');
        const loveMovies = await fetchMoviesByGenre('Romantic');
        const biographyMovies = await fetchMoviesByGenre('Biography');
        const horrorMovies = await fetchMoviesByGenre('Horror');
        const mysteryMovies = await fetchMoviesByGenre('Mystery');

        const response = {
            actionMovies,
            comedyMovies,
            loveMovies,
            biographyMovies,
            horrorMovies,
            mysteryMovies,
        };

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': 'http://localhost:3000',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Credentials': 'true',
            },
            body: JSON.stringify(response),
        };
    } catch (error) {
        console.error("Error fetching movie data:", error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': 'http://localhost:3000',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Credentials': 'true',
            },
            body: JSON.stringify({ message: "Error fetching movie data", error: error.message }),
        };
    }
};



exports.moviebyId = async (event) => {
    const auth = verifyJwtFromCookies(event);

    if (!auth.isAuthorized) {
        return {
            statusCode: 401,
            headers: {
                'Access-Control-Allow-Origin': 'http://localhost:3000',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Credentials': 'true',
            },
            body: JSON.stringify({ message: auth.message }),
        };
    }

    const { movie_id } = event.pathParameters;
    const { email } = auth.user;

    const movieParams = {
        TableName: MOVIE_TABLE,
        Key: { movie_id: movie_id },
    };

    try {
        const movieData = await dynamoDb.get(movieParams).promise();
        if (!movieData.Item) {
            return {
                statusCode: 404,
                headers: {
                    'Access-Control-Allow-Origin': 'http://localhost:3000',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Credentials': 'true',
                },
                body: JSON.stringify({ error: 'Movie not found' }),
            };
        }

        const userParams = {
            TableName: USERS_TABLE,
            Key: { email: email },
        };

        const userData = await dynamoDb.get(userParams).promise();
        const rentedMovies = userData.Item?.current_rented_movies || [];

        const isMovieRented = rentedMovies.some((rentedMovie) => rentedMovie.movie_id === movie_id);

        let movieResponse = { ...movieData.Item };

        if (movieData.Item.price === 0 || (isMovieRented && movieData.Item.movie_url)) {
            const s3Params = {
                Bucket: BUCKET_NAME,
                Key: `MovieVideo/${movieData.Item.movie_url}`,
                Expires: 600,
            };

            const presignedUrl = await s3.getSignedUrlPromise('getObject', s3Params);
            movieResponse.presigned_url = presignedUrl;
        }

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': 'http://localhost:3000',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Credentials': 'true',
            },
            body: JSON.stringify(movieResponse),
        };
    } catch (error) {
        console.error('Error fetching movie or user data:', error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': 'http://localhost:3000',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Credentials': 'true',
            },
            body: JSON.stringify({ error: 'Could not fetch movie or user profile' }),
        };
    }
};



exports.likeupdate = async (event) => {
    const movieId = event.pathParameters.movie_id;

    const params = {
        TableName: MOVIE_TABLE,
        Key: { movie_id: movieId },
        UpdateExpression: 'SET likes = if_not_exists(likes, :start) + :incr',
        ExpressionAttributeValues: {
            ':start': 0,
            ':incr': 1,
        },
        ReturnValues: 'UPDATED_NEW',
    };

    try {
        const result = await dynamoDb.update(params).promise();

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': 'http://localhost:3000',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Credentials': 'true',
            },
            body: JSON.stringify(result.Attributes),
        }
    } catch (error) {
        console.error('Error updating likes:', error);

        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': 'http://localhost:3000',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Credentials': 'true',
            },
            body: JSON.stringify({ error: 'Unable to update likes' }),
        };
    }
};



exports.searchmovie = async (event) => {
    const { title } = event.queryStringParameters || {};

    if (!title) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "Title is required" }),
            headers: {
                'Access-Control-Allow-Origin': 'http://localhost:3000',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Credentials': 'true',
            },
        }
    }

    const lowercaseTitle = title.toLowerCase();

    const params = {
        TableName: MOVIE_TABLE,
    };

    try {
        const data = await dynamoDb.scan(params).promise();

        const matchedMovie = data.Items.find(item => item.title.toLowerCase().includes(lowercaseTitle));

        if (matchedMovie) {
            return {
                statusCode: 200,
                body: JSON.stringify({ movie_id: matchedMovie.movie_id }),
                headers: {
                    'Access-Control-Allow-Origin': 'http://localhost:3000',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Credentials': 'true',
                },
            };
        } else {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: "Movie not found" }),
                headers: {
                    'Access-Control-Allow-Origin': 'http://localhost:3000',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Credentials': 'true',
                },
            };
        }
    } catch (error) {
        console.error("Error searching movies:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Internal server error" }),
            headers: {
                'Access-Control-Allow-Origin': 'http://localhost:3000',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Credentials': 'true',
            },
        }
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




exports.filterhandler= async (event) => {
    const { type, value } = JSON.parse(event.body);
    console.log({type,value}) 
    let response;

    try {
        switch (type) {
            case "genre":
                response = await getMoviesByGenre(value);
                break;
            case "top_imdb":
                response = await getTopRatedMovies();
                break;
            case "most_liked":
                response = await getMostLikedMovies();
                break;
            case "top_new_release":
                response = await getTopNewReleases();
                break;
            case "year":
                response = await getMoviesByYear(value);
                break;
            case "free":
                response = await getFreeMovies();
                break;
            default:
                response = await getAllMovies(); 
                break;
        }

        return {
            statusCode: 200,
            body: JSON.stringify(response),
            headers: {
                'Access-Control-Allow-Origin': 'http://localhost:3000',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Credentials': 'true',
            },
        };
    } catch (error) {
        console.error('Error fetching data:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal Server Error', error }),
            headers: {
                'Access-Control-Allow-Origin': 'http://localhost:3000',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Credentials': 'true',
            },
        };
    }
};

const getAllMovies = async () => {
    const params = {
        TableName: MOVIE_TABLE,
        Limit: 50, 
    };
    
    const result = await dynamoDb.scan(params).promise();
    return result.Items;
};

const getMoviesByGenre = async (genre) => {
    if(genre==='All'){
        const params = {
            TableName: MOVIE_TABLE,
            ProjectionExpression: 'movie_id, title, poster_url',
            Limit: 40, 
        };
        
        const result = await dynamoDb.scan(params).promise();
        return result.Items;
    }
    else{
        const params = {
            TableName: MOVIE_TABLE,
            IndexName: 'genre-index', 
            KeyConditionExpression: 'genre = :genreValue',
            ExpressionAttributeValues: {
                ':genreValue': genre,
            },
            Limit: 20,
        };
    
        const result = await dynamoDb.query(params).promise();
        return result.Items;
    }
};

const getTopRatedMovies = async () => {
    const params = {
        TableName: MOVIE_TABLE,
        IndexName: 'rating-index', 
        ProjectionExpression: 'movie_id, title, rating, poster_url',
        ScanIndexForward: false,
        Limit: 20,
    };

    const result = await dynamoDb.scan(params).promise();
    return result.Items.sort((a, b) => b.rating - a.rating);
};

const getMostLikedMovies = async () => {
    const params = {
        TableName: MOVIE_TABLE,
        IndexName: 'likes-index',
        ProjectionExpression: 'movie_id, title, likes, poster_url',
        ScanIndexForward: false, 
        Limit: 20,
    };

    const result = await dynamoDb.scan(params).promise();
    return result.Items.sort((a, b) => b.likes - a.likes); 
};

const getTopNewReleases = async () => {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const formattedDate = threeMonthsAgo.toISOString();

    const params = {
        TableName: MOVIE_TABLE,
        ProjectionExpression: 'movie_id, title, release_date, poster_url',
    };

    try {
        const result = await dynamoDb.scan(params).promise();

        const filteredItems = result.Items.filter(item => 
            new Date(item.release_date) >= new Date(formattedDate)
        );
        const sortedItems = filteredItems.sort((a, b) => 
            new Date(b.release_date) - new Date(a.release_date)
        );
        return sortedItems; 
    } catch (error) {
        console.error("Error fetching recent movies:", error);
        throw error;
    }
};

const getMoviesByYear = async (year) => {
    const startDate = `${year}-01-01T00:00:00Z`;
    const endDate = `${year}-12-31T23:59:59Z`;

    const params = {
        TableName: MOVIE_TABLE,
        FilterExpression: 'release_date BETWEEN :startDate AND :endDate',
        ExpressionAttributeValues: {
            ':startDate': startDate,
            ':endDate': endDate,
        },
        ProjectionExpression: 'movie_id, title, release_date, poster_url',
    };

    const result = await dynamoDb.scan(params).promise();
    return result.Items.sort((a, b) => new Date(b.release_date) - new Date(a.release_date));
};

const getFreeMovies = async () => {
    const params = {
        TableName: MOVIE_TABLE,
        FilterExpression: 'price = :freePrice',
        ExpressionAttributeValues: {
            ':freePrice': 0,
        },
        ProjectionExpression: 'movie_id, title, price, poster_url',
    };

    const result = await dynamoDb.scan(params).promise();
    return result.Items;
};


const AWS = require('aws-sdk');
const cookie = require('cookie');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const USERS_TABLE = 'user-data';
const CONTACT_TABLE = 'contact-form-data'
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRATION = '3h';


exports.signuphandler = async (event) => {
  try {
    const data = JSON.parse(event.body);
    const { username, email, password, phone_number, genres } = data;

    if (!username || !email || !password || !phone_number || !Array.isArray(genres) || genres.length === 0) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': 'http://localhost:3000',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Credentials': 'true',
        },
        body: JSON.stringify({ message: 'Missing required fields' }),
      };
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const params = {
      TableName: USERS_TABLE,
      Item: {
        username,
        email,
        password: hashedPassword,
        phone_number,
        genre: genres,
        current_rented_movies: [],
        old_movies: [],
        wishlist: [],
      },
      ConditionExpression: 'attribute_not_exists(email)',
    };

    await dynamoDb.put(params).promise();

    return {
      statusCode: 201,
      headers: {
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: JSON.stringify({ message: 'User created successfully' }),
    };
  } catch (error) {
    console.error('Signup Error:', error);

    if (error.code === 'ConditionalCheckFailedException') {
      return {
        statusCode: 409,
        headers: {
          'Access-Control-Allow-Origin': 'http://localhost:3000',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Credentials': 'true',
        },
        body: JSON.stringify({ message: 'User already exists' }),
      };
    }

    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: JSON.stringify({ message: 'Could not create user' }),
    };
  }
};

exports.loginhandler = async (event) => {
  try {
    const data = JSON.parse(event.body);
    const { email, password } = data;

    if (!email || !password) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': 'http://localhost:3000',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Credentials': 'true',
        },
        body: JSON.stringify({ message: 'Email and password are required' }),
      };
    }

    const params = {
      TableName: USERS_TABLE,
      Key: { email },
    };

    const result = await dynamoDb.get(params).promise();

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: {
          'Access-Control-Allow-Origin': 'http://localhost:3000',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Credentials': 'true',
        },
        body: JSON.stringify({ message: 'User not found' }),
      };
    }

    const user = result.Item;
    const isPasswordMatch = await bcrypt.compare(password, user.password);

    if (!isPasswordMatch) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': 'http://localhost:3000',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Credentials': 'true',
        },
        body: JSON.stringify({ message: 'Invalid credentials' }),
      };
    }

    const expiryDate = new Date(Date.now() + 3 * 60 * 60 * 1000).toUTCString();
    const token = jwt.sign({ email: user.email, username: user.username }, JWT_SECRET, { expiresIn: TOKEN_EXPIRATION });

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
        'Set-Cookie': `jwt=${token}; HttpOnly; Expires=${expiryDate}; SameSite=None; Secure; Path=/`,
      },
      body: JSON.stringify({ message: 'Login successful', user: { username: user.username, email: user.email } }),
    };
  } catch (error) {
    console.error('Login Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: JSON.stringify({ message: 'Could not log in' }),
    };
  }
};

exports.logouthandler = async (event) => {
  try {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
        'Set-Cookie': 'jwt=; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=None; Secure; Path=/',
      },
      body: JSON.stringify({ message: 'Logout successful' }),
    };
  } catch (error) {
    console.error('Logout Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: JSON.stringify({ message: 'Could not log out' }),
    };
  }
};

exports.userMeHandler = async (event) => {
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

  const email = auth.user.email;
  const currentDate = new Date().toISOString();

  try {
    const userProfile = await dynamoDb.get({
      TableName: USERS_TABLE,
      Key: { email },
    }).promise();

    if (!userProfile.Item) {
      return {
        statusCode: 404,
        headers: {
          'Access-Control-Allow-Origin': 'http://localhost:3000',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Credentials': 'true',
        },
        body: JSON.stringify({ message: 'User not found' }),
      };
    }

    const { current_rented_movies, old_movies } = userProfile.Item;

    if (current_rented_movies && current_rented_movies.length > 0) {
      const newCurrentRentedMovies = [];
      const updatedOldMovies = [...old_movies];

      for (const movie of current_rented_movies) {
        if (new Date(movie.end_date) < new Date(currentDate)) {
          updatedOldMovies.push(movie);
        } else {
          newCurrentRentedMovies.push(movie);
        }
      }

      await dynamoDb.update({
        TableName: USERS_TABLE,
        Key: { email },
        UpdateExpression: 'SET current_rented_movies = :currentRentedMovies, old_movies = :oldMovies',
        ExpressionAttributeValues: {
          ':currentRentedMovies': newCurrentRentedMovies,
          ':oldMovies': updatedOldMovies,
        },
      }).promise();
    }

    const { username } = auth.user;
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: JSON.stringify({ username, email }),
    };

  } catch (error) {
    console.error("Error processing user data:", error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: JSON.stringify({ message: "Error fetching or updating user data", error: error.message }),
    };
  }
};

exports.profileHandler = async (event) => {
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

  const { email } = auth.user;

  const params = {
    TableName: USERS_TABLE,
    Key: { email },
  };

  try {
    const result = await dynamoDb.get(params).promise();
    if (!result.Item) {
      return {
        statusCode: 404,
        headers: {
          'Access-Control-Allow-Origin': 'http://localhost:3000',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Credentials': 'true',
        },
        body: JSON.stringify({ message: 'User not found' }),
      };
    }
    const { password, old_movies, ...userProfile } = result.Item;
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: JSON.stringify(userProfile),
    };
  } catch (error) {
    console.error('Error fetching user profile from DynamoDB:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: JSON.stringify({ message: 'Internal Server Error during profile retrieval' }),
    };
  }
};


exports.wishlisthandler = async (event) => {
  const authResult = verifyJwtFromCookies(event);
  if (!authResult.isAuthorized) {
    return {
      statusCode: 401,
      headers: {
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: JSON.stringify({ success: false, message: authResult.message }),
    };
  }

  const userEmail = authResult.user.email;
  const body = JSON.parse(event.body);
  const { movie_id, poster_url, title } = body;

  if (!movie_id || !poster_url || !title) {
    return {
      statusCode: 400,
      headers: {
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: JSON.stringify({ success: false, message: "Missing movie details" }),
    };
  }

  const getParams = {
    TableName: USERS_TABLE,
    Key: { email: userEmail },
    ProjectionExpression: 'wishlist',
  };

  try {
    const result = await dynamoDb.get(getParams).promise();
    let wishlist = result.Item?.wishlist || [];

    const existingMovieIndex = wishlist.findIndex(movie => movie.movie_id === movie_id);

    if (existingMovieIndex !== -1) {
      const [existingMovie] = wishlist.splice(existingMovieIndex, 1);

      wishlist.push(existingMovie);
    } else {
      wishlist.push({ movie_id, poster_url, title });
    }

    const updateParams = {
      TableName: USERS_TABLE,
      Key: { email: userEmail },
      UpdateExpression: "SET wishlist = :updatedWishlist",
      ExpressionAttributeValues: {
        ":updatedWishlist": wishlist,
      },
      ReturnValues: "UPDATED_NEW",
    };

    await dynamoDb.update(updateParams).promise();

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: JSON.stringify({ success: true, message: "Wishlist updated successfully" }),
    };
  } catch (error) {
    console.error('Error updating wishlist:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: JSON.stringify({ success: false, message: "Failed to update wishlist" }),
    };
  }
};


const verifyJwtFromCookies = (event) => {
  try {
    const cookieHeader = event.headers.Cookie || event.headers.cookie;

    if (!cookieHeader) {
      return { isAuthorized: false, message: 'Unauthorized: No cookies present' };
    }

    const cookies = cookie.parse(cookieHeader);
    const token = cookies.jwt;

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


exports.contactformhandler = async (event) => {
    const { name, email, subject, message } = JSON.parse(event.body);
    
    const submissionID = uuidv4();
    const params = {
        TableName: CONTACT_TABLE,
        Item: {
            SubmissionID: submissionID,
            Name: name,
            Email: email,
            Subject: subject,
            Message: message,
            SubmittedAt: new Date().toISOString(),
        },
    };

    try {
        await dynamoDb.put(params).promise();
        return {
            statusCode: 200,
            headers: {
              'Access-Control-Allow-Origin': 'http://localhost:3000',
              'Access-Control-Allow-Headers': 'Content-Type',
              'Access-Control-Allow-Credentials': 'true',
            },
            body: JSON.stringify({
                message: 'Form submission successful!',
                submissionID,
            }),
        };
    } catch (error) {
        return {
            statusCode: 500,
            headers: {
              'Access-Control-Allow-Origin': 'http://localhost:3000',
              'Access-Control-Allow-Headers': 'Content-Type',
              'Access-Control-Allow-Credentials': 'true',
            },
            body: JSON.stringify({
                message: 'Error submitting the form',
                error: error.message,
            }),
        };
    }
};


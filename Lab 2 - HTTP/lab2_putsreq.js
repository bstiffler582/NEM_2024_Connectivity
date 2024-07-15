// resource endpoint
// https://putsreq.com/RlFsRfglQsarf07mbaSz

response.status = 401;
response.body = "Unauthorized";

const recipes = [
    { id: 1, ag1_speed: 80, mix_time: 300, temp_sp: 45.0 },
    { id: 2, ag1_speed: 73, mix_time: 290, temp_sp: 45.5 },
    { id: 3, ag1_speed: 69, mix_time: 330, temp_sp: 44.8 },
    { id: 4, ag1_speed: 76, mix_time: 295, temp_sp: 44.5 },
    { id: 5, ag1_speed: 70, mix_time: 280, temp_sp: 45.5 },
    { id: 6, ag1_speed: 80, mix_time: 310, temp_sp: 46.0 },
    { id: 7, ag1_speed: 83, mix_time: 220, temp_sp: 45.9 }
];

const auth = request.headers["AUTHORIZATION"];
if (auth && auth === "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9__NEM2024") {
    const id = parseInt(request.params.recipeId);
    if (id && id >= 1 && id <= 7) {
        response.status = 200;
        response.headers["Content-Type"] = "application/json";
        response.body = JSON.stringify(recipes[id - 1]);
    } else {
        response.status = 404;
        response.body = "Recipe ID not found."
    }
}

// --------------------------------

// auth endpoint
// https://putsreq.com/6h0nzE2faGfK23K9UzFV

const req = JSON.parse(request.body);
if (!req.client_id || !req.client_secret) {
    response.status = 400;
    response.body = "Bad Request";
} else {
    if (req.client_id === "nem_2024" && req.client_secret === "super_secret_client_secret") {
        response.body = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9__NEM2024";
    } else {
        response.status = 401;
        response.body = "Unauthorized";
    }
}
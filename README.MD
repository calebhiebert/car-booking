# Car Booking Utility

Originally created while working at the 2017 Canada Games, this application assists with staff booking vehicles for use during games preparation. Supports google calendar integration.

## Get Started

This app requires a google api project with the `People` and `Calendar` apis enabled.

This app also requires a [Mailgun](https://www.mailgun.com/) account.

**Step 1.** Clone the repository

```
git clone https://github.com/calebhiebert/CarBooking
```

**Step 2.** Copy the env file to .env and edit accordingly

```
cp env .env
```

**Step 3.** Run the app with docker compose. That's it. If you do not have docker, keep going.

```
docker-compose up
```

**Step 4.** If you do not have docker, the app can be run without it. Use your favorite package manager to install packages.

```
yarn
```

**Step 5. Run the application**

```
yarn dev
```
